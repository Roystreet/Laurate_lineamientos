import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/platform/server.js';
import { migrate,pool } from '../../src/platform/db.js';
import { claim,heartbeat,settle } from '../../src/platform/queue.js';
import { processTask } from '../../src/platform/processor.js';

await migrate();const app=await buildServer();
async function upload(fields,name,data){
  const boundary=randomUUID(),parts=Object.entries(fields).map(([k,v])=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.from(data),Buffer.from(`\r\n--${boundary}--\r\n`));
  const response=await app.inject({method:'POST',url:'/api/uploads',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat(parts)});
  assert.equal(response.statusCode,202);return response.json().files[0];
}
async function drain(){let task;while((task=await claim())){
  const timer=setInterval(()=>heartbeat(task).catch(()=>{}),10000);
  console.log(`Procesando ${task.tipo}…`);
  try{await processTask(task);await settle(task);}catch(error){await settle(task,error.message);throw error;}finally{clearInterval(timer);}
}}
try{
  const ficha=await upload({kind:'ficha',code:'9.9.9.9'},'ficha.txt',`FICHA DEL REQUERIMIENTO
CÓDIGO: 9.9.9.9
REQUERIMIENTO: La universidad cuenta con un plan de capacitación.
CONSIDERACIONES DEL REQUERIMIENTO:
1. El plan debe indicar responsables y un presupuesto anual.
EXIGENCIAS DE LA CALIDAD VINCULADAS: Ninguna.
`);
  await drain();
  const browser=await chromium.launch();let scanned;
  try{
    const page=await browser.newPage({viewport:{width:900,height:1200}});
    await page.setContent(`<html lang="es"><body style="margin:0;padding:65px;font-family:Arial;font-size:23px;background:white;color:#111;box-sizing:border-box;height:1200px"><h1 style="font-size:34px">Plan de capacitación 2026</h1><p>Objetivo: capacitar al personal administrativo.</p><p>Responsable: Dirección de Recursos Humanos.</p><p>Actividad: realizar dos talleres en octubre de 2026.</p><p>Seguimiento: asistencia y evaluación trimestral.</p><table style="border-collapse:collapse;width:100%;margin-top:35px"><tr><th style="border:1px solid;padding:18px">Concepto</th><th style="border:1px solid;padding:18px">Presupuesto anual</th></tr><tr><td style="border:1px solid;padding:18px">Capacitación</td><td style="border:1px solid;padding:18px">S/ 1.234,56</td></tr></table><p style="position:absolute;bottom:55px;font-size:17px">PLAN-CAP-01 | Versión 3 | 01/10/2026</p></body></html>`);
    const image=await page.screenshot();
    await page.setContent(`<html><body style="margin:0"><img style="display:block;width:900px;height:1200px" src="data:image/png;base64,${image.toString('base64')}"/></body></html>`);
    scanned=await page.pdf({width:'900px',height:'1200px',margin:{top:0,left:0,right:0,bottom:0},printBackground:true});
  }finally{await browser.close();}
  const evidence=await upload({kind:'evidencia',reqId:ficha.requirementId},'plan-escaneado.pdf',scanned);
  await drain();
  const doc=(await app.inject(`/api/documents/${evidence.documentId}`)).json();
  assert.equal(doc.estado,'complete');assert.equal(doc.pages[0].metodo,'ocr');assert.match(doc.texto,/1[.,]234[.,]56/);assert.match(doc.texto,/PLAN-CAP-01/);assert.match(doc.texto,/Versi[oó]n 3/i);
  const response=await app.inject({method:'POST',url:'/api/runs',payload:{requirementIds:[ficha.requirementId]}});assert.equal(response.statusCode,202);
  await drain();
  const detail=(await app.inject(`/api/runs/${response.json().id}`)).json();assert.equal(detail.estado,'complete');assert.equal(detail.results.length,6);assert.equal(detail.reports.length,4);
  console.log('Prueba real completada: ficha extraída, PDF escaneado transcrito, seis criterios registrados y cuatro reportes exportados.');
}finally{await app.close();await pool.end();}
