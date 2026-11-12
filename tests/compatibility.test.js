import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {createPaths,PATHS} from '../src/config/paths.js';
import {readHallazgosExcel,writeHallazgosExcel} from '../src/helpers/excel.helper.js';
import {runStep5} from '../src/steps/5-consolidar-hallazgos/index.js';
import {runStep3} from '../src/steps/3-generar-excel-por-requerimiento/index.js';
import {runStep4} from '../src/steps/4-generar-matriz-total-lineamientos/index.js';
import {evaluarCriterio,buildContext,rowsFromC1} from '../src/steps/2-procesar-requerimiento/index.js';
import {planCriterios} from '../src/prompt/criterios/index.js';

async function workbook(file){const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);return wb.worksheets.map(ws=>({name:ws.name,columns:ws.columns.map(c=>({width:c.width})),rows:Array.from({length:ws.rowCount},(_,i)=>Array.from({length:ws.columnCount},(_,j)=>ws.getRow(i+1).getCell(j+1).value ?? '')) ,styles:ws.getRow(1).values.map((_,i)=>({font:ws.getRow(1).getCell(i).font})),wrap:ws.columns.map(c=>c.alignment)}));}
test('all existing extraction and auditing prompt files remain byte-identical',async()=>{
  const hashes=JSON.parse(await fs.readFile('tests/fixtures/prompt-hashes.json','utf8'));
  for(const [file,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),hash,file);
});
test('delivered hallazgos, inventories and consolidated workbook retain fields, data, order and styles',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'laureate-reports-')),paths=createPaths(root);
  try{
    await fs.cp(PATHS.mutable.base,paths.mutable.base,{recursive:true});
    for(const code of ['3.1.1.2','5.3.1.14','5.4.2.8']){
      const source=path.join(PATHS.inmutableHallazgos,code,`${code}.xlsx`),out=path.join(paths.inmutableHallazgos,code,`${code}.xlsx`);
      const rows=await readHallazgosExcel(source);assert.equal(rows.length,{'3.1.1.2':20,'5.3.1.14':18,'5.4.2.8':61}[code]);await writeHallazgosExcel(out,rows);assert.deepEqual(await workbook(out),await workbook(source));
    }
    const consolidated=await runStep5({}, {paths});assert.equal(consolidated.totalFilas,48);assert.equal(consolidated.maxLineamientos,6);
    assert.deepEqual(await workbook(path.join(paths.inmutableConsolidado,'consolidado.xlsx')),await workbook(path.join(PATHS.inmutableConsolidado,'consolidado.xlsx')));
    // Delivered inventory previews include conversion timestamps from an older input snapshot.
    // Reconstruct only that metadata in temporary inputs, then compare complete workbooks.
    for(const name of await fs.readdir(PATHS.matriz))if(name.endsWith('.xlsx')){
      const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(PATHS.matriz,name));
      for(let i=2;i<=wb.worksheets[0].rowCount;i++){
        const row=wb.worksheets[0].getRow(i),code=String(row.getCell(1).value),id=String(row.getCell(2).value),preview=String(row.getCell(4).value);
        const date=preview.match(/generadoEn: "([^"]+)"/)?.[1];
        if(date){const file=path.join(paths.mutable.lineamientos,`req_${code}`,`${id}.md`);const md=await fs.readFile(file,'utf8');await fs.writeFile(file,md.replace(/generadoEn: "[^"]+"/,`generadoEn: "${date}"`));}
      }
      if(name==='matriz-total-lineamientos.xlsx')await runStep4({}, {paths});else await runStep3({}, {paths});
      assert.deepEqual(await workbook(path.join(paths.matriz,name)),await workbook(path.join(PATHS.matriz,name)));
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('consolidated contract covers mixed compliance, repeated evidence, empty values, errors and numeric ordering',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'laureate-edge-')),paths=createPaths(root);
  const base={n_req:'2.1',requerimiento:'Requerimiento',tipo_requerimiento:'plan',criterio:'Información completa',lineamientos_evaluados:'B | A | C'};
  try{
    const rows=[
      {...base,consideracion_evaluada:'Condición',lineamiento:'B',cumple_consideracion:'no',literal:'Falta B',observacion:'Motivo B'},
      {...base,consideracion_evaluada:'Condición',lineamiento:'B',cumple_consideracion:'si',literal:'Duplicado ignorado',observacion:'Duplicado ignorado'},
      {...base,consideracion_evaluada:'Condición',lineamiento:'A',cumple_consideracion:'si',literal:'Cita A',observacion:'Motivo A'},
      {...base,consideracion_evaluada:'Otra',lineamiento:'C',cumple_consideracion:'no',literal:'N/A'},
      {...base,consideracion_evaluada:'Otra',lineamiento:'C',cumple_consideracion:'si',literal:'Duplicado ignorado'},
      {...base,hallazgo:'General C1',estado:'No cumple'},
      {...base,criterio:'Coherencia',hallazgo:'ERROR: conexión',estado:'No cumple'},
      {...base,criterio:'Mejora continua',hallazgo:'N/A',estado:'No aplica'},
    ];
    await writeHallazgosExcel(path.join(paths.inmutableHallazgos,'2.1','2.1.xlsx'),rows);
    await writeHallazgosExcel(path.join(paths.inmutableHallazgos,'10.1','10.1.xlsx'),[{...base,n_req:'10.1',criterio:'Integración',hallazgo:'Hallazgo C6',estado:'Cumple',lineamientos_evaluados:'Z'}]);
    const result=await runStep5({}, {paths});assert.equal(result.totalFilas,6);assert.equal(result.maxLineamientos,3);
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(paths.inmutableConsolidado,'consolidado.xlsx'));
    const ws=wb.worksheets[0],headers=ws.getRow(1).values.slice(1),data=[];
    for(let i=2;i<=ws.rowCount;i++)data.push(Object.fromEntries(headers.map((h,j)=>[h,ws.getRow(i).getCell(j+1).value])));
    assert.deepEqual(data.map(r=>r.n_req),['2.1','2.1','2.1','2.1','2.1','10.1']);
    assert.equal(data[0].estado,'Cumple');assert.equal(data[0].lineamiento_1,'B');assert.equal(data[0].resultado_1,'no');assert.equal(data[0].lineamiento_2,'A');
    assert.equal(data[0].literal,'B: Falta B\nA: Cita A');assert.equal(data[0].observacion,'B: Motivo B\nA: Motivo A');
    assert.equal(data[0].lineamiento_3,'NO APLICA');assert.equal(data[1].estado,'No cumple');assert.equal(data[1].literal,'NO APLICA');
    assert.equal(data[2].detalle,'General C1');assert.equal(data[2].lineamiento_3,'C');assert.equal(data[3].detalle,'ERROR: conexión');
    assert.equal(data[4].estado,'No aplica');assert.equal(data[4].detalle,'NO APLICA');assert.equal(data[5].lineamiento_1,'Z');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('platform criterion calls use the exact builder and preserve No aplica, errors and defaults',async()=>{
  const args={n_req:'1.1',requerimiento:'1.1 Plan',tipo:'plan',consideraciones:['Objetivo'],lineamientos:'### LINEAMIENTO: A\ntexto',lineamientoIds:['A'],relacionados:[]};
  const ctx=buildContext({codigo:'1.1',requerimientoTexto:args.requerimiento,tipo:'plan',lineamientoIds:['A']});
  for(const tipo of ['plan','lineamiento','informe','reporte'])for(const criterion of planCriterios(tipo)){
    const input={...args,tipo},context={...ctx,tipo_requerimiento:tipo};
    const r=await evaluarCriterio(criterion,{ctx:context,buildArgs:input,llm:async({system,user})=>{assert.deepEqual({system,user},criterion.build(input));return {rawText:criterion.id===1?'{}':'[]'};}});
    assert.equal(r.rows[0].estado,criterion.aplica?'Cumple':'No aplica');
  }
  const criterion=planCriterios('lineamiento')[0];
  const result=await evaluarCriterio(criterion,{ctx,buildArgs:args,llm:async()=>{throw new Error('timeout');}});assert.equal(result.error,true);assert.equal(result.rows[0].estado,'No cumple');
  const rows=rowsFromC1({consideraciones:[{consideracion:'x',por_lineamiento:[{lineamiento:'A',cumple:'si',literal:'cita',observacion:'motivo'},{lineamiento:'B',cumple:'no'}]}]},criterion.nombre,ctx);
  assert.equal(rows.length,2);assert.equal(rows[0].cumple_consideracion,'si');assert.equal(rows[1].estado,'No cumple');
});
