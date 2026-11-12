import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import serveStatic from '@fastify/static';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config, publicConfig } from '../config/runtime.js';
import { ROOT } from '../config/paths.js';
import { SUPPORTED_EXTS } from '../helpers/parsers/index.js';
import { pool, query, json } from './db.js';
import { storagePath, fileHash } from './storage.js';
import * as model from './model.js';
import { registerConfigIaRoutes } from './config-ia/routes.js';
import { production } from './config-ia/versions.js';

const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
async function validateSignature(file,ext) {
  const handle=await fsp.open(file,'r');
  try{
    const bytes=Buffer.alloc(16);await handle.read(bytes,0,16,0);
    const valid=ext==='.pdf'?bytes.subarray(0,5).toString()==='%PDF-'
      :['.xlsx','.xlsm','.docx'].includes(ext)?bytes.subarray(0,2).toString()==='PK'
      :ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      :['.jpg','.jpeg'].includes(ext)?bytes[0]===255&&bytes[1]===216:true;
    if(!valid) throw failure('El contenido del archivo no coincide con su formato.');
  }finally{await handle.close();}
}
export async function buildServer() {
  const app=Fastify({logger:false,bodyLimit:1024*1024});
  await app.register(multipart,{limits:{fileSize:config.uploadMb*1024*1024,files:config.uploadFiles,fields:10,parts:config.uploadFiles+10}});
  app.setErrorHandler((error,request,reply)=>{
    let message=error.message;
    for(const secret of [process.env.OPENAI_API_KEY,config.mysql.password].filter(Boolean)) message=message.split(secret).join('[oculto]');
    const status=error.statusCode ?? (error.code==='ER_DUP_ENTRY'?409:500);
    reply.code(status).send({error:status>=500?'No fue posible completar la operación. Revisa el servicio y vuelve a intentar.':message});
    if(status>=500) console.error(`${request.method} ${request.url}: ${error.code ?? 'error interno'}`);
  });
  app.addHook('onRequest',async(request)=>{
    if(['POST','PUT','PATCH','DELETE'].includes(request.method) && request.headers.origin){
      const origin=new URL(request.headers.origin);
      if(origin.host!==request.headers.host) throw failure('Origen no permitido.',403);
    }
  });
  app.get('/api/health',async()=>{await query('SELECT 1');return {ok:true};});
  app.get('/api/config',async()=>({parameters:publicConfig(),formats:SUPPORTED_EXTS,maxRequirements:10,reglasVersion:(await production()).numero}));
  registerConfigIaRoutes(app);
  app.get('/api/requirements',()=>model.requirements());
  app.get('/api/requirements/:id/documents',(req)=>model.documents(req.params.id));
  app.get('/api/evidence-library',()=>model.evidenceLibrary());
  app.post('/api/requirements/:id/evidences',async(req,reply)=>reply.code(201).send(await model.associateEvidence(req.params.id,req.body?.documentId,req.body?.lineamiento)));
  app.get('/api/documents/:id',async(req)=>{
    const [doc]=await query('SELECT d.id,d.nombre_original,d.clase,d.requerimiento_id,d.version_actual,v.estado,v.texto,v.markdown,v.error,v.metadata FROM documentos d JOIN versiones_documento v ON v.id=d.version_actual WHERE d.id=?',[req.params.id]);
    if(!doc) throw failure('Documento no encontrado.',404);
    const versions=await query('SELECT id,nombre_original,estado,force_ocr,error,created_at FROM versiones_documento WHERE documento_id=? ORDER BY created_at DESC,id DESC',[doc.id]);
    const pages=await query('SELECT numero,metodo,estado,texto,error FROM paginas_documento WHERE documento_version_id=? ORDER BY numero',[doc.version_actual]);
    const tasks=await query("SELECT id,estado,error,intentos FROM tareas_procesamiento WHERE tipo='prepare' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.versionId'))=? ORDER BY created_at DESC",[doc.version_actual]);
    return {...doc,metadata:doc.metadata?json(doc.metadata):{},versions,pages,tasks};
  });
  app.get('/api/versions/:id',async(req)=>{
    const [version]=await query('SELECT v.id,v.estado,v.texto,v.markdown,v.error,v.created_at,COALESCE(v.nombre_original,d.nombre_original) nombre_original FROM versiones_documento v JOIN documentos d ON d.id=v.documento_id WHERE v.id=?',[req.params.id]);
    if(!version) throw failure('Versión no encontrada.',404);
    return {...version,pages:await query('SELECT numero,metodo,estado,texto,error FROM paginas_documento WHERE documento_version_id=? ORDER BY numero',[version.id])};
  });
  app.get('/api/versions/:id/original',async(req,reply)=>{
    const [version]=await query('SELECT COALESCE(v.nombre_original,d.nombre_original) nombre_original,v.original_path FROM versiones_documento v JOIN documentos d ON d.id=v.documento_id WHERE v.id=?',[req.params.id]);
    if(!version) throw failure('Versión no encontrada.',404);
    reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(version.nombre_original)}`);
    return reply.type('application/octet-stream').send(fs.createReadStream(storagePath(version.original_path)));
  });
  app.get('/api/documents/:id/original',async(req,reply)=>{
    const [doc]=await query('SELECT d.nombre_original,v.original_path FROM documentos d JOIN versiones_documento v ON v.id=d.version_actual WHERE d.id=?',[req.params.id]);
    if(!doc) throw failure('Documento no encontrado.',404);
    reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(doc.nombre_original)}`);
    return reply.type('application/octet-stream').send(fs.createReadStream(storagePath(doc.original_path)));
  });
  app.post('/api/uploads',async(req,reply)=>{
    const fields={},files=[],result=[];
    try{
      for await(const part of req.parts()){
        if(part.type==='field'){fields[part.fieldname]=String(part.value);continue;}
        const name=path.basename(part.filename ?? '').normalize('NFC'),ext=path.extname(name).toLowerCase();
        if(!name || !SUPPORTED_EXTS.includes(ext)){part.file.resume();throw failure(`Formato no admitido: ${ext || 'sin extensión'}.`);}
        const file=storagePath('uploads',randomUUID(),`original${ext}`);
        await fsp.mkdir(path.dirname(file),{recursive:true});files.push({name,file,ext});
        await pipeline(part.file,fs.createWriteStream(file));
        if(part.file.truncated) throw failure(`El archivo supera ${config.uploadMb} MB.`,413);
        await validateSignature(file,ext);
      }
      if(!files.length) throw failure('Selecciona al menos un archivo.');
      if(fields.replaceId && files.length!==1) throw failure('Reemplazar admite un archivo a la vez.');
      for(const item of files){
        try{
          const code=fields.code || item.name.match(/\d+(?:\.\d+){0,5}/)?.[0];
          const registered=await model.registerUpload({code,reqId:fields.reqId,kind:fields.kind,name:item.name,file:item.file,hash:await fileHash(item.file),replaceId:fields.replaceId,lineamiento:fields.lineamiento});
          result.push({name:item.name,ok:true,...registered});
        }catch(error){await fsp.rm(path.dirname(item.file),{recursive:true,force:true});result.push({name:item.name,ok:false,error:error.message});}
      }
      return reply.code(result.some(r=>r.ok)?202:400).send({files:result});
    }catch(error){for(const item of files)await fsp.rm(path.dirname(item.file),{recursive:true,force:true});throw error;}
  });
  app.post('/api/documents/:id/ocr',async(req,reply)=>reply.code(202).send(await model.reprocess(req.params.id)));
  app.patch('/api/documents/:id/association',async(req)=>{
    if(typeof req.body?.active!=='boolean') throw failure('active debe ser un booleano.');
    await model.detach(req.params.id,req.body.active,req.body.reqId);return {ok:true};
  });
  app.post('/api/runs',async(req,reply)=>reply.code(202).send(await model.startRun(req.body?.requirementIds)));
  app.get('/api/runs',()=>model.runs());
  app.get('/api/runs/:id',(req)=>model.runDetail(req.params.id));
  app.post('/api/tasks/:id/retry',async(req,reply)=>reply.code(202).send(await model.retryTask(req.params.id)));
  app.get('/api/preparation',()=>query("SELECT t.id,t.estado,t.intentos,t.error,JSON_UNQUOTE(JSON_EXTRACT(t.payload,'$.versionId')) versionId FROM tareas_procesamiento t WHERE tipo='prepare' ORDER BY created_at DESC LIMIT 100"));
  app.get('/api/reports/:id/download',async(req,reply)=>{
    const [report]=await query('SELECT nombre,archivo_path FROM reportes WHERE id=?',[req.params.id]);
    if(!report) throw failure('Reporte no encontrado.',404);
    reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(report.nombre)}`);
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(fs.createReadStream(storagePath(report.archivo_path)));
  });
  const dist=path.join(ROOT,'web','dist');
  if(fs.existsSync(dist)){
    await app.register(serveStatic,{root:dist});
    app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'Ruta no encontrada.'}):reply.sendFile('index.html'));
  }
  return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=await buildServer();
  const shutdown=async()=>{await app.close();await pool.end();};
  process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
  await app.listen({host:config.host,port:config.port});
  console.log(`Plataforma disponible en http://${config.host}:${config.port}`);
}
