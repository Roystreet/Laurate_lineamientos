import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {parsePdf} from '../src/helpers/parsers/parsePdf.js';
import {extractPages} from '../src/ocr/service.js';
import {loadConfig} from '../src/config/runtime.js';
import {parseAny} from '../src/helpers/parsers/index.js';
test('PNG and JPEG uploads use image transcription with the configured model and detail',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocr-image-'));
  try{
    for(const ext of ['png','jpg','jpeg']){
      const file=path.join(dir,`scan.${ext}`);await fs.writeFile(file,'image fixture');
      const parsed=await parseAny(file,{pageDir:dir,settings:loadConfig({OCR_MODEL:'gpt-5.4-mini',OCR_IMAGE_DETAIL:'original'}),llm:async(args)=>{
        assert.equal(args.model,'gpt-5.4-mini');assert.equal(args.images[0].detail,'original');assert.match(args.images[0].url,new RegExp(`^data:image/${ext==='png'?'png':'jpeg'};base64,`));
        return {rawText:'{"text":"Artículo 2.1 | S/ 1.234,56 | Pie v3","blank":false,"illegible":false}'};
      }});
      assert.equal(parsed.pages[0].method,'ocr');assert.match(parsed.text,/1\.234,56/);
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('digital PDFs retain the original pdf-parse text exactly',async()=>{
  const file='data/data-sin-procesar/lineamientos_requerimiento/req_5.3.1.14/politica-desvinculacion.pdf';
  const original=await pdfParse(await fs.readFile(file));const parsed=await parsePdf(file,{settings:loadConfig({OCR_MODE:'off'})});
  assert.equal(parsed.text,original.text);assert.equal(parsed.pages.length,original.numpages);assert.ok(parsed.pages.every(p=>p.method==='native'));
});
test('mixed document OCR transcribes only missing pages, retaining order, tables, and footers',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocr-test-')),image=path.join(dir,'image.png');await fs.writeFile(image,'fixture');let calls=0;
  try{
    const pages=await extractPages('fixture.pdf',['Documento digital '.repeat(10),'','Otra página digital '.repeat(10)],{settings:loadConfig({}),pageDir:dir,
      render:async(_,page)=>{assert.equal(page,2);return image;},llm:async()=>{calls++;return {rawText:JSON.stringify({text:'| Meta | Monto |\n|---|---|\n| 2025 | 1.234,56 |\nCódigo ABC · Versión 2',blank:false,illegible:false})};}});
    assert.equal(calls,1);assert.deepEqual(pages.map(p=>p.method),['native','ocr','native']);assert.match(pages[1].text,/1\.234,56/);assert.match(pages[1].text,/Versión 2/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('blank, illegible, failed and cached pages remain distinct; retry skips completed OCR',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ocr-test-')),image=path.join(dir,'x.png');await fs.writeFile(image,'fixture');const events=[];
  try{
    await assert.rejects(()=>extractPages('x.pdf',['',''],{pageDir:dir,render:async()=>image,onPage:p=>events.push(p),llm:async()=>{if(events.length)throw new Error('network');return {rawText:'{"text":"","blank":true,"illegible":false}'};}}),/network/);
    assert.equal(events[0].status,'blank');assert.equal(events[1].status,'error');let calls=0;
    const pages=await extractPages('x.pdf',['',''],{pageDir:dir,cachedPages:events,render:async()=>image,llm:async()=>{calls++;return {rawText:'{"text":"Texto [ILEGIBLE]","blank":false,"illegible":true}'};}});
    assert.equal(calls,1);assert.equal(pages[1].status,'illegible');
    await assert.rejects(()=>extractPages('x.png',[''],{settings:loadConfig({OCR_MODE:'off'}),pageDir:dir}),/desactivado/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
