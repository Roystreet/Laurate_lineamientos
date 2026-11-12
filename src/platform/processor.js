import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from './db.js';
import { assertLease } from './queue.js';
import { config } from '../config/runtime.js';
import { createPaths } from '../config/paths.js';
import { storagePath, storageKey, fileHash, digest } from './storage.js';
import { parseAny } from '../helpers/parsers/index.js';
import { buildLineamientoMd, buildRequerimientoMd } from '../helpers/markdown.helper.js';
import { callOpenAI } from '../llm/openai.client.js';
import { parseLlmJsonObject } from '../llm/parse-json.js';
import { buildPromptConvertirRequerimientosJson } from '../prompt/propmt-convertir-requerimientos-json/index.js';
import { normalizeFicha } from '../steps/generar-json-requerimientos/index.js';
import { buildContext, evaluarCriterio } from '../steps/2-procesar-requerimiento/index.js';
import { planCriterios } from '../prompt/criterios/index.js';
import { writeHallazgosExcel } from '../helpers/excel.helper.js';
import { runStep3 } from '../steps/3-generar-excel-por-requerimiento/index.js';
import { runStep4 } from '../steps/4-generar-matriz-total-lineamientos/index.js';
import { runStep5 } from '../steps/5-consolidar-hallazgos/index.js';

function trackedLlm(task, stage, llm, settings = config) {
  return async (args) => {
    const id = randomUUID(), start = Date.now();
    const messages = { system:args.system, user:args.user,
      images:(args.images ?? []).map((i)=>({sha256:digest(i.url),detail:i.detail})) };
    await transaction(async(c)=>{
      await assertLease(task,c);
      await query('INSERT INTO llamadas_llm(id,tarea_id,etapa,modelo,mensajes) VALUES (?,?,?,?,?)',[id,task.id,stage,args.model,JSON.stringify(messages)],c);
    });
    try {
      const response=await llm({...args,timeoutMs:settings.timeoutMs,maxAttempts:settings.maxAttempts});
      await query('UPDATE llamadas_llm SET respuesta=?,uso=?,duracion_ms=? WHERE id=?',[response.rawText,JSON.stringify(response.usage ?? null),Date.now()-start,id]);
      return response;
    } catch(error) {
      await query('UPDATE llamadas_llm SET error=?,duracion_ms=? WHERE id=?',[error.message,Date.now()-start,id]);
      throw error;
    }
  };
}

export async function saveFicha(reqId, versionId, ficha, c, activate = true) {
  const id=randomUUID();
  await query('INSERT INTO versiones_requerimiento(id,requerimiento_id,documento_version_id,ficha) VALUES (?,?,?,?)',[id,reqId,versionId,JSON.stringify(ficha)],c);
  for(let i=0;i<ficha.consideraciones.length;i++) await query('INSERT INTO consideraciones(id,version_requerimiento_id,orden,texto) VALUES (?,?,?,?)',[randomUUID(),id,i,ficha.consideraciones[i]],c);
  for(let i=0;i<ficha.requerimientos_relacionados.length;i++) await query('INSERT INTO relaciones_requerimiento(version_requerimiento_id,orden,codigo) VALUES (?,?,?)',[id,i,ficha.requerimientos_relacionados[i]],c);
  if(activate) await query('UPDATE requerimientos SET version_actual=? WHERE id=?',[id,reqId],c);
  return id;
}

async function prepare(task, llm) {
  const versionId=task.payload.versionId;
  const [doc]=await query(`SELECT v.*,d.clase,COALESCE(v.nombre_original,d.nombre_original) nombre_original,d.requerimiento_id,d.version_actual,r.codigo,e.lineamiento
    FROM versiones_documento v JOIN documentos d ON d.id=v.documento_id JOIN requerimientos r ON r.id=d.requerimiento_id
    LEFT JOIN requerimiento_evidencias e ON e.documento_id=d.id AND e.requerimiento_id=d.requerimiento_id WHERE v.id=?`,[versionId]);
  if(!doc) throw new Error('Versión del documento no encontrada.');
  // A process may stop after committing preparation but before acknowledging the job.
  if(doc.estado==='complete') return;
  const settings={...config,...json(doc.configuracion)};
  await query("UPDATE versiones_documento SET estado='processing',error=NULL WHERE id=?",[versionId]);
  const cached=await query('SELECT numero page,metodo method,estado status,texto text,texto_nativo nativeText,imagen_path imagePath FROM paginas_documento WHERE documento_version_id=? ORDER BY numero',[versionId]);
  try {
    const parsed=await parseAny(storagePath(doc.original_path),{
      settings,forceOcr:Boolean(doc.force_ocr),pageDir:storagePath('pages',versionId),cachedPages:cached,
      llm:trackedLlm(task,'ocr',llm,settings),
      onPage:async(p)=>transaction(async(c)=>{
        await assertLease(task,c);
        await query(`INSERT INTO paginas_documento(documento_version_id,numero,metodo,estado,texto,texto_nativo,imagen_path,error)
          VALUES (?,?,?,?,?,?,?,?) AS new ON DUPLICATE KEY UPDATE metodo=new.metodo,estado=new.estado,texto=new.texto,texto_nativo=new.texto_nativo,imagen_path=new.imagen_path,error=new.error`,
          [versionId,p.page,p.method,p.status,p.text,p.nativeText ?? '',p.imagePath ? storageKey(p.imagePath) : null,p.error ?? null],c);
      }),
    });
    if(!String(parsed.text).trim()) throw new Error('El documento está vacío; no se obtuvo texto para analizar.');
    let ficha=null;
    if(doc.clase==='ficha') {
      const {system,user}=buildPromptConvertirRequerimientosJson({codigo:doc.codigo,contenido:parsed.text.trim()});
      const response=await trackedLlm(task,'ficha',llm,settings)({system,user,model:settings.fichaModel,reasoningEffort:settings.fichaEffort});
      ficha=normalizeFicha(parseLlmJsonObject(response.rawText),{codigo:doc.codigo});
    }
    const fuente=`data/data-sin-procesar/${doc.clase==='ficha' ? `requerimientos/${doc.codigo}${path.extname(doc.original_path)}` : `lineamientos_requerimiento/req_${doc.codigo}/${doc.nombre_original}`}`.replaceAll('/','\\');
    const markdown=doc.clase==='ficha'
      ? buildRequerimientoMd({codigo:doc.codigo,contenido:parsed.text,fuente})
      : buildLineamientoMd({codigoReq:doc.codigo,idLineamiento:doc.lineamiento,titulo:parsed.meta?.titulo ?? '',contenido:parsed.text,fuente});
    await transaction(async(c)=>{
      await assertLease(task,c);
      await query("UPDATE versiones_documento SET estado='complete',texto=?,markdown=?,metadata=?,error=NULL WHERE id=?",[parsed.text,markdown,JSON.stringify(parsed.meta ?? {}),versionId],c);
      if(ficha) {
        // Superseded uploads retain their parsed document, but cannot replace the active catalog.
        const [latest]=await query('SELECT d.version_actual FROM requerimientos r JOIN documentos d ON d.id=r.documento_ficha_actual WHERE r.id=?',[doc.requerimiento_id],c);
        await saveFicha(doc.requerimiento_id,versionId,ficha,c,latest?.version_actual===versionId);
      }
    });
  }catch(error){
    await transaction(async(c)=>{
      await assertLease(task,c);
      await query("UPDATE versiones_documento SET estado='error',error=? WHERE id=?",[error.message,versionId],c);
    });
    throw error;
  }
}

export async function saveResult(runId,reqId,result,c) {
  const existing=await query('SELECT id FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? AND criterio_id=?',[runId,reqId,result.criterio.id],c);
  const id=existing[0]?.id ?? randomUUID();
  if(existing.length){
    await query('DELETE FROM evaluaciones_consideracion WHERE resultado_id=?',[id],c);
    await query('DELETE FROM hallazgos WHERE resultado_id=?',[id],c);
    await query('UPDATE resultados_criterio SET estado_tecnico=?,filas=? WHERE id=?',[result.error?'error':'complete',JSON.stringify(result.rows),id],c);
  }else await query('INSERT INTO resultados_criterio(id,ejecucion_id,requerimiento_id,criterio_id,nombre,estado_tecnico,filas) VALUES (?,?,?,?,?,?,?)',[id,runId,reqId,result.criterio.id,result.criterio.nombre,result.error?'error':'complete',JSON.stringify(result.rows)],c);
  for(let i=0;i<result.rows.length;i++){
    const row=result.rows[i];
    if(row.consideracion_evaluada) await query('INSERT INTO evaluaciones_consideracion(resultado_id,orden,consideracion,lineamiento,cumple,observacion,literal) VALUES (?,?,?,?,?,?,?)',[id,i,row.consideracion_evaluada,row.lineamiento,row.cumple_consideracion,row.observacion,row.literal],c);
    else await query('INSERT INTO hallazgos(resultado_id,orden,contenido) VALUES (?,?,?)',[id,i,JSON.stringify(row)],c);
  }
}

async function analyze(task,llm) {
  const [run]=await query('SELECT * FROM ejecuciones WHERE id=?',[task.ejecucion_id]);
  const snapshot=json(run.snapshot), settings={...config,...json(run.configuracion)};
  const req=snapshot.requirements.find((r)=>r.id===task.payload.requirementId);
  if(!req) throw new Error('Entrada congelada no encontrada.');
  await query("UPDATE ejecuciones SET estado='running' WHERE id=?",[run.id]);
  const lineamientoIds=req.evidencias.map(d=>d.lineamiento);
  const lineamientos=req.evidencias.map(d=>`### LINEAMIENTO: ${d.lineamiento}\n${d.markdown.trim()}`).join('\n\n---\n\n');
  const {nombre_requerimiento,tipo,consideraciones,requerimientos_relacionados}=req.ficha;
  const relacionados=requerimientos_relacionados.map((codigo)=>{
    const related=snapshot.catalog.find(r=>r.codigo===codigo);
    return {codigo,nombre_requerimiento:related?.ficha.nombre_requerimiento ?? `${codigo} (ficha no encontrada)`,consideraciones:related?.ficha.consideraciones ?? []};
  });
  const ctx=buildContext({codigo:req.codigo,requerimientoTexto:nombre_requerimiento,tipo,lineamientoIds});
  const buildArgs={n_req:req.codigo,requerimiento:nombre_requerimiento,tipo,consideraciones,lineamientos,lineamientoIds,relacionados};
  const previous=await query("SELECT criterio_id FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? AND estado_tecnico='complete'",[run.id,req.id]);
  const completed=new Set(previous.map(r=>r.criterio_id));
  await Promise.all(planCriterios(tipo).filter(c=>!completed.has(c.id)).map(async(criterio)=>{
    const result=await evaluarCriterio(criterio,{dryRun:false,ctx,buildArgs,dryMeta:{consideraciones,lineamientoIds},
      llm:trackedLlm(task,`criterio_${criterio.id}`,llm,settings),model:settings.analysisModel,reasoningEffort:settings.analysisEffort});
    await transaction(async(c)=>{await assertLease(task,c);await saveResult(run.id,req.id,result,c);});
  }));
}

export async function generateReports(runId,{task}={}) {
  const [run]=await query('SELECT * FROM ejecuciones WHERE id=?',[runId]);
  // A stale worker can finish writing files, but cannot overwrite the active export.
  const snapshot=json(run.snapshot), paths=createPaths(storagePath('executions',runId,...(task ? [task.lease_owner] : [])));
  await fs.mkdir(paths.mutable.requerimientosJson,{recursive:true});
  const results=await query('SELECT * FROM resultados_criterio WHERE ejecucion_id=? ORDER BY criterio_id',[runId]);
  const reportFiles=[];
  for(const req of snapshot.requirements){
    await fs.writeFile(path.join(paths.mutable.requerimientosJson,`${req.codigo}.json`),JSON.stringify(req.ficha));
    const linDir=path.join(paths.mutable.lineamientos,`req_${req.codigo}`);
    await fs.mkdir(linDir,{recursive:true});
    for(const doc of req.evidencias) await fs.writeFile(path.join(linDir,`${doc.lineamiento}.md`),doc.markdown);
    const rows=results.filter(r=>r.requerimiento_id===req.id).flatMap(r=>json(r.filas));
    if(rows.length){
      const file=path.join(paths.inmutableHallazgos,req.codigo,`${req.codigo}.xlsx`);
      await writeHallazgosExcel(file,rows);reportFiles.push({tipo:'hallazgos',file});
    }
  }
  await runStep3({}, {paths});await runStep4({}, {paths});
  const consolidated=await runStep5({}, {paths});
  if(consolidated.ok) reportFiles.push({tipo:'consolidado',file:path.join(paths.inmutableConsolidado,'consolidado.xlsx')});
  reportFiles.push({tipo:'inventario_total',file:path.join(paths.matriz,'matriz-total-lineamientos.xlsx')});
  for(const req of snapshot.requirements) reportFiles.push({tipo:'inventario',file:path.join(paths.matriz,`req_${req.codigo}.xlsx`)});
  const records=await Promise.all(reportFiles.map(async(r)=>({...r,hash:await fileHash(r.file)})));
  await transaction(async(c)=>{
    if(task) await assertLease(task,c);
    for(const r of records) await query(`INSERT INTO reportes(id,ejecucion_id,tipo,nombre,archivo_path,sha256) VALUES (?,?,?,?,?,?) AS new
      ON DUPLICATE KEY UPDATE archivo_path=new.archivo_path,sha256=new.sha256`,[randomUUID(),runId,r.tipo,path.basename(r.file),storageKey(r.file),r.hash],c);
    const incomplete=results.some(r=>r.estado_tecnico==='error') || results.length!==snapshot.requirements.length*6;
    await query('UPDATE ejecuciones SET estado=?,finished_at=NOW(3),error=NULL WHERE id=?',[incomplete?'partial':'complete',runId],c);
  });
}

export async function processTask(task,{llm=callOpenAI}={}) {
  if(task.tipo==='prepare') return prepare(task,llm);
  if(task.tipo==='analyze') return analyze(task,llm);
  if(task.tipo==='reports') return generateReports(task.ejecucion_id,{task});
  throw new Error('Tipo de tarea desconocido.');
}
