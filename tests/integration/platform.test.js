import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/platform/server.js';
import { pool,migrate,query,json,transaction } from '../../src/platform/db.js';
import { claim,settle,assertLease,enqueue } from '../../src/platform/queue.js';
import { processTask } from '../../src/platform/processor.js';

const condition='La política debe indicar responsables.';
function multipart(fields,name,content){
  const boundary='laureate-'+randomUUID();
  const parts=Object.entries(fields).map(([k,v])=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.from(content),Buffer.from(`\r\n--${boundary}--\r\n`));
  return {payload:Buffer.concat(parts),headers:{'content-type':`multipart/form-data; boundary=${boundary}`}};
}
test('MySQL platform: uploads, extraction, frozen inputs, partial reports, targeted retries, leases and downloads',async()=>{
  await migrate();const app=await buildServer();let failCoherence=true;const calls=[];
  const fake=async(args)=>{
    calls.push(args);
    if(args.system.includes('Extractor de Datos Normativos'))return {rawText:JSON.stringify({nombre_requerimiento:'9.9.9.9 La universidad cuenta con políticas',tipo:'lineamiento',consideraciones:[condition],requerimientos_relacionados:[]})};
    if(args.system.includes('Transcribe fielmente'))return {rawText:JSON.stringify({text:'Política institucional\nResponsable: Dirección\nCódigo ABC · Versión 2',blank:false,illegible:false})};
    const criterion=args.system.match(/CRITERIO A EVALUAR: ([^\n]+)/)?.[1];
    if(criterion==='Coherencia'&&failCoherence)throw new Error('Simulated connection error');
    if(criterion==='Información completa')return {rawText:JSON.stringify({consideraciones:[{consideracion:condition,por_lineamiento:[{lineamiento:'politica',cumple:'si',literal:'Responsable: Dirección',observacion:'Indica responsable.'}]}],hallazgos_generales:[]})};
    return {rawText:JSON.stringify([{criterio:criterion,estado:'Cumple',tipo_hallazgo:'Cumple',literal:'Responsable: Dirección',observacion:'Documento consistente.',razonamiento_previo:'Análisis del conjunto.',hallazgo:'N/A',lineamiento_afectado:'politica',integracion:criterion==='Integración'?'Integrado':'',requerimientos_relacionados:[]}])};
  };
  const drain=async()=>{let task;while((task=await claim())){try{await processTask(task,{llm:fake});await settle(task);}catch(e){await settle(task,e.message);}}};
  const upload=async(fields,name,content)=>app.inject({method:'POST',url:'/api/uploads',...multipart(fields,name,content)});
  try{
    assert.equal((await app.inject('/api/health')).statusCode,200);
    const cfg=(await app.inject('/api/config')).json();assert.ok(!JSON.stringify(cfg).includes(process.env.OPENAI_API_KEY));assert.ok(!JSON.stringify(cfg).includes(process.env.MYSQL_PASSWORD));
    assert.equal((await upload({kind:'ficha',code:'../escape'},'bad.txt','data')).statusCode,400);
    assert.equal((await upload({kind:'ficha',code:'9.9.9.9'},'fake.pdf','not a PDF')).statusCode,400);
    let response=await upload({kind:'ficha',code:'9.9.9.9'},'ficha.txt','Ficha del requerimiento. CONSIDERACIONES DEL REQUERIMIENTO: '+condition);assert.equal(response.statusCode,202);
    const reqId=response.json().files[0].requirementId;await drain();
    const req=(await app.inject('/api/requirements')).json()[0];assert.equal(req.ficha.consideraciones[0],condition);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1WQAAAAASUVORK5CYII=','base64');
    response=await upload({kind:'evidencia',reqId},'politica.png',png);assert.equal(response.statusCode,202);const docId=response.json().files[0].documentId;await drain();
    const doc=(await app.inject(`/api/documents/${docId}`)).json();assert.equal(doc.pages[0].metodo,'ocr');assert.match(doc.texto,/Versión 2/);
    response=await app.inject({method:'POST',url:`/api/documents/${docId}/ocr`});assert.equal(response.statusCode,202);await drain();
    const reprocessed=(await app.inject(`/api/documents/${docId}`)).json();assert.notEqual(reprocessed.version_actual,doc.version_actual);assert.equal(reprocessed.versions.length,2);
    assert.equal((await app.inject(`/api/versions/${doc.version_actual}`)).json().texto,doc.texto);
    assert.equal((await upload({kind:'evidencia',reqId},'politica.txt','duplicate')).statusCode,400);
    response=await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[reqId]}});assert.equal(response.statusCode,202);const runId=response.json().id;
    assert.equal((await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[reqId]}})).statusCode,409);
    // Replace before processing: the running snapshot must still contain the original OCR text.
    response=await upload({kind:'evidencia',reqId,replaceId:docId},'replacement.txt','Responsable nuevo: otra área.');assert.equal(response.statusCode,202);await drain();
    const replaced=(await app.inject(`/api/documents/${docId}`)).json();assert.equal(replaced.nombre_original,'replacement.txt');
    const oldOriginal=await app.inject(`/api/versions/${doc.version_actual}/original`);assert.equal(oldOriginal.statusCode,200);assert.ok(oldOriginal.headers['content-disposition'].includes('politica.png'));assert.deepEqual(oldOriginal.rawPayload,png);
    const newOriginal=await app.inject(`/api/documents/${docId}/original`);assert.ok(newOriginal.headers['content-disposition'].includes('replacement.txt'));assert.equal(newOriginal.body,'Responsable nuevo: otra área.');
    let detail=(await app.inject(`/api/runs/${runId}`)).json();assert.equal(detail.estado,'partial');assert.equal(detail.results.length,6);assert.equal(detail.reports.length,4);
    const prompt=calls.find(c=>c.system.includes('CRITERIO A EVALUAR: Información completa'));assert.match(prompt.user,/Responsable: Dirección/);assert.ok(!prompt.user.includes('Responsable nuevo'));
    const snapshot=json((await query('SELECT snapshot FROM ejecuciones WHERE id=?',[runId]))[0].snapshot);assert.equal(snapshot.requirements[0].evidencias[0].version_id,reprocessed.version_actual);
    const motor=json((await query('SELECT m.contenido FROM versiones_motor m JOIN ejecuciones e ON e.motor_id=m.id WHERE e.id=?',[runId]))[0].contenido);
    assert.ok(motor.sources['src/ocr/service.js']);assert.ok(!JSON.stringify(motor).includes(process.env.OPENAI_API_KEY));
    const succeeded=detail.results.filter(r=>r.estado_tecnico==='complete').map(r=>r.id);const callsBefore=calls.length;
    failCoherence=false;const task=detail.tasks.find(t=>t.tipo==='analyze');response=await app.inject({method:'POST',url:`/api/tasks/${task.id}/retry`});assert.equal(response.statusCode,202);await drain();
    detail=(await app.inject(`/api/runs/${runId}`)).json();assert.equal(detail.estado,'complete');assert.equal(calls.length-callsBefore,1);for(const id of succeeded)assert.ok(detail.results.some(r=>r.id===id));
    assert.equal((await query('SELECT COUNT(*) n FROM resultados_criterio WHERE ejecucion_id=?',[runId]))[0].n,6);
    const consolidated=detail.reports.find(r=>r.tipo==='consolidado');const download=await app.inject(`/api/reports/${consolidated.id}/download`);assert.equal(download.statusCode,200);assert.equal(download.rawPayload.subarray(0,2).toString(),'PK');
    // Lease recovery fences the old worker and does not repeat completed preparation.
    await enqueue('prepare',{versionId:response.json().versionId ?? doc.version_actual});const old=await claim();assert.ok(old);
    await query('UPDATE tareas_procesamiento SET lease_until=DATE_SUB(NOW(3),INTERVAL 1 SECOND) WHERE id=?',[old.id]);
    const resumed=await claim();assert.equal(resumed.id,old.id);assert.notEqual(resumed.lease_owner,old.lease_owner);
    await assert.rejects(()=>transaction(c=>assertLease(old,c)),/expiró/);assert.equal((await settle(old)).affectedRows,0);
    await processTask(resumed,{llm:fake});await settle(resumed);
    // A genuine JSON parser error is recoverable and cannot become a ready document.
    response=await upload({kind:'evidencia',reqId},'invalid.json','{broken');assert.equal(response.statusCode,202);await drain();
    const failed=(await app.inject(`/api/documents/${response.json().files[0].documentId}`)).json();assert.equal(failed.estado,'error');assert.ok(failed.tasks.some(t=>t.estado==='error'));
    assert.equal((await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[reqId]}})).statusCode,400);
    // Superseded failed fichas must not block a newer successful upload.
    const older=(await upload({kind:'ficha',code:'9.9.9.9'},'old.json','{broken')).json().files[0];
    const newer=(await upload({kind:'ficha',code:'9.9.9.9'},'new.txt','Nueva ficha preparada.')).json().files[0];await drain();
    const catalog=(await app.inject('/api/requirements')).json()[0];assert.equal(catalog.documento_ficha_actual,newer.documentId);assert.equal(catalog.fichas_pendientes,0);
    assert.equal((await app.inject(`/api/documents/${older.documentId}`)).json().estado,'error');
    const [latest]=await query('SELECT documento_version_id FROM versiones_requerimiento WHERE id=?',[catalog.version_actual]);assert.equal(latest.documento_version_id,newer.versionId);
    await app.inject({method:'PATCH',url:`/api/documents/${failed.id}/association`,payload:{active:false}});
    assert.equal((await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[reqId]}})).statusCode,202);await drain();
    // Reuse one prepared document across requirements, with independent association state.
    const second=(await upload({kind:'ficha',code:'2.2'},'2.2.txt','Ficha del segundo requerimiento.')).json().files[0];await drain();
    const library=(await app.inject('/api/evidence-library')).json();assert.ok(library.some(d=>d.id===docId));
    assert.equal((await app.inject({method:'POST',url:`/api/requirements/${second.requirementId}/evidences`,payload:{}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:`/api/requirements/${second.requirementId}/evidences`,payload:{documentId:newer.documentId}})).statusCode,404);
    response=await app.inject({method:'POST',url:`/api/requirements/${second.requirementId}/evidences`,payload:{documentId:docId,lineamiento:'lineamiento-compartido'}});assert.equal(response.statusCode,201);
    assert.equal((await app.inject({method:'POST',url:`/api/requirements/${second.requirementId}/evidences`,payload:{documentId:docId,lineamiento:'duplicado'}})).statusCode,409);
    const shared=(await app.inject(`/api/requirements/${second.requirementId}/documents`)).json().find(d=>d.id===docId);assert.equal(shared.compartido,1);assert.equal(shared.lineamiento,'lineamiento-compartido');
    const callsBeforeLink=calls.length;
    response=await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[second.requirementId]}});assert.equal(response.statusCode,202);const sharedRun=response.json().id;
    const frozen=json((await query('SELECT snapshot FROM ejecuciones WHERE id=?',[sharedRun]))[0].snapshot).requirements[0];assert.match(frozen.evidencias[0].markdown,/requerimiento: 2\.2/);assert.match(frozen.evidencias[0].markdown,/# Lineamiento lineamiento-compartido \(req 2\.2\)/);
    assert.match((await query('SELECT markdown FROM versiones_documento WHERE id=?',[shared.version_actual]))[0].markdown,/requerimiento: 9\.9\.9\.9/);
    await app.inject({method:'PATCH',url:`/api/documents/${docId}/association`,payload:{active:false,reqId}});
    assert.equal((await app.inject(`/api/requirements/${second.requirementId}/documents`)).json().find(d=>d.id===docId).activa,1);
    await app.inject({method:'PATCH',url:`/api/documents/${docId}/association`,payload:{active:false,reqId:second.requirementId}});await drain();
    const sharedDetail=(await app.inject(`/api/runs/${sharedRun}`)).json();assert.equal(sharedDetail.inputs[0].evidencias[0].lineamiento,'lineamiento-compartido');assert.equal(sharedDetail.results.length,6);assert.ok(calls.length>callsBeforeLink);
    const history=(await app.inject('/api/runs')).json().find(r=>r.id===sharedRun);assert.deepEqual(history.requirementIds,[second.requirementId]);
  }finally{await app.close();await pool.end();}
});
