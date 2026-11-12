import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PATHS } from '../src/config/paths.js';
import { publicConfig } from '../src/config/runtime.js';
import { pool,query,transaction,migrate } from '../src/platform/db.js';
import { storagePath,storageKey,fileHash,digest } from '../src/platform/storage.js';
import { saveFicha,saveResult,generateReports } from '../src/platform/processor.js';
import { readHallazgosExcel } from '../src/helpers/excel.helper.js';
import { CRITERIOS } from '../src/prompt/criterios/index.js';
import { preserveHistoricalReports } from '../src/platform/historical-reports.js';

try {
  await migrate();
  if((await query('SELECT id FROM requerimientos LIMIT 1')).length){
    console.log('El catálogo ya contiene datos. La importación inicial no sobrescribe información.');
  }else{
    const names=(await fs.readdir(PATHS.mutable.requerimientosJson)).filter(n=>n.endsWith('.json')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const prepared=[];
    for(const name of names){
      const code=path.basename(name,'.json'),ficha=JSON.parse(await fs.readFile(path.join(PATHS.mutable.requerimientosJson,name),'utf8'));
      const original=(await fs.readdir(PATHS.sinProcesar.requerimientos)).find(n=>path.basename(n,path.extname(n))===code);
      if(!original)throw new Error(`Falta el archivo original de ${code}.`);
      const documents=[];
      async function add(clase,file,markdown,lineamiento){
        const id=randomUUID(),version=randomUUID(),stored=storagePath('uploads',id,`original${path.extname(file).toLowerCase()}`);
        await fs.mkdir(path.dirname(stored),{recursive:true});await fs.copyFile(file,stored);
        documents.push({id,version,clase,name:path.basename(file),original:storageKey(stored),hash:await fileHash(stored),markdown,lineamiento});
      }
      await add('ficha',path.join(PATHS.sinProcesar.requerimientos,original),await fs.readFile(path.join(PATHS.mutable.requerimientos,code,`${code}.md`),'utf8'));
      const inputDir=path.join(PATHS.sinProcesar.lineamientos,`req_${code}`);
      for(const input of (await fs.readdir(inputDir)).sort()){
        const key=path.basename(input,path.extname(input));
        await add('evidencia',path.join(inputDir,input),await fs.readFile(path.join(PATHS.mutable.lineamientos,`req_${code}`,`${key}.md`),'utf8'),key);
      }
      const rows=await readHallazgosExcel(path.join(PATHS.inmutableHallazgos,code,`${code}.xlsx`));
      prepared.push({id:randomUUID(),code,ficha,documents,rows});
    }
    const runId=await transaction(async(c)=>{
      await query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE',[],c);
      if((await query('SELECT id FROM requerimientos LIMIT 1',[],c)).length)throw new Error('El catálogo cambió durante la importación.');
      const inputs=[];
      for(const req of prepared){
        await query('INSERT INTO requerimientos(id,codigo) VALUES (?,?)',[req.id,req.code],c);
        let fichaVersion;
        for(const d of req.documents){
          await query('INSERT INTO documentos(id,requerimiento_id,clase,nombre_original,version_actual) VALUES (?,?,?,?,?)',[d.id,req.id,d.clase,d.name,d.version],c);
          await query("INSERT INTO versiones_documento(id,documento_id,nombre_original,original_path,sha256,estado,texto,markdown,configuracion,metadata) VALUES (?,?,?,?,?,'complete',?,?,?,?)",[d.version,d.id,d.name,d.original,d.hash,d.markdown,d.markdown,JSON.stringify({historical:true}),JSON.stringify({historical:true})],c);
          if(d.clase==='ficha'){
            await query('UPDATE requerimientos SET documento_ficha_actual=? WHERE id=?',[d.id,req.id],c);
            fichaVersion=await saveFicha(req.id,d.version,req.ficha,c);
          }
          else await query('INSERT INTO requerimiento_evidencias(id,requerimiento_id,documento_id,lineamiento) VALUES (?,?,?,?)',[randomUUID(),req.id,d.id,d.lineamiento],c);
        }
        inputs.push({id:req.id,codigo:req.code,version:fichaVersion,ficha:req.ficha,evidencias:req.documents.filter(d=>d.clase==='evidencia').map(d=>({id:d.id,version_id:d.version,lineamiento:d.lineamiento,nombre_original:d.name,markdown:d.markdown}))});
      }
      const id=randomUUID(),motorId=randomUUID();
      await query('INSERT INTO versiones_motor(id,sha256,contenido) VALUES (?,?,?)',[motorId,digest('historical-local-reports'),JSON.stringify({historical:true,origin:'Reportes existentes; parámetros originales no acreditados.'})],c);
      const snapshot={requirements:inputs,catalog:inputs.map(r=>({id:r.id,codigo:r.codigo,ficha:r.ficha,version_actual:r.version}))};
      await query("INSERT INTO ejecuciones(id,estado,configuracion,motor_id,snapshot) VALUES (?,'running',?,?,?)",[id,JSON.stringify({historical:true}),motorId,JSON.stringify(snapshot)],c);
      for(let i=0;i<prepared.length;i++){
        const req=prepared[i],input=inputs[i];
        await query('INSERT INTO entradas_ejecucion(ejecucion_id,requerimiento_id,orden,version_requerimiento_id,evidencia) VALUES (?,?,?,?,?)',[id,req.id,i,input.version,JSON.stringify(input.evidencias)],c);
        for(const criterion of CRITERIOS){
          const rows=req.rows.filter(r=>r.criterio===criterion.nombre);
          if(rows.length)await saveResult(id,req.id,{criterio:criterion,rows,error:rows.some(r=>String(r.hallazgo).startsWith('ERROR:'))},c);
        }
      }
      return id;
    });
    await generateReports(runId);
    await preserveHistoricalReports(runId);
    console.log(`Importación completada: ${prepared.length} requerimientos y ${prepared.reduce((s,r)=>s+r.documents.length-1,0)} evidencias. Sin llamadas a OpenAI.`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
