import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ExcelJS from 'exceljs';

const exec=promisify(execFile);

test('text extraction handles large defined ranges within a small heap and preserves cell values',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'documental-xlsx-'));
  try{
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Presupuesto');
    sheet.addRow(['Concepto','Monto','Fecha','Detalle','Enlace','Error','Activo']);
    sheet.addRow(['Mantenimiento',{formula:'500+250',result:750},new Date('2026-01-02T00:00:00Z'),{richText:[{text:'Plan '},{text:'anual',font:{bold:true}}]},{text:'Documento',hyperlink:'https://example.com/documento'},{error:'#N/A'},false]);
    sheet.getCell('C2').numFmt='yyyy-mm-dd';
    sheet.getCell('A4').value='Total';sheet.mergeCells('A4:B4');
    workbook.addWorksheet('Resumen').addRow(['Monto',750]);
    // Serialize valid names without expanding their millions of cells while making the fixture.
    Object.defineProperty(workbook.definedNames,'model',{get:()=>Array.from({length:24},(_,i)=>({name:`rango_${i}`,ranges:["'Presupuesto'!$B$1:$D$65536"]}))});
    const file=path.join(directory,'presupuesto.xlsx');await workbook.xlsx.writeFile(file);
    const moduleUrl=new URL('../src/helpers/parsers/parseXlsx.js',import.meta.url).href;
    let output;
    try{
      output=await exec(process.execPath,['--max-old-space-size=96','--input-type=module','-e',`import {parseXlsx} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await parseXlsx(process.argv[1])));`,file],{timeout:30000,maxBuffer:65536});
    }catch(error){assert.fail(`Excel text extraction must finish without exhausting memory: ${error.stderr || error.message}`);}
    const parsed=JSON.parse(output.stdout);
    assert.deepEqual(parsed.meta,{sheets:['Presupuesto','Resumen']});
    assert.deepEqual(parsed.sheets,[{name:'Presupuesto',rows:[['Concepto','Monto','Fecha','Detalle','Enlace','Error','Activo'],['Mantenimiento','750','2026-01-02','Plan anual','Documento','#N/A','false'],['Total','Total']]},{name:'Resumen',rows:[['Monto','750']]}]);
    assert.equal(parsed.text,'# Presupuesto\nConcepto | Monto | Fecha | Detalle | Enlace | Error | Activo\nMantenimiento | 750 | 2026-01-02 | Plan anual | Documento | #N/A | false\nTotal | Total\n\n# Resumen\nMonto | 750\n');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
