import {test,expect} from '@playwright/test';
const tourKey='documental:tour:v1';
const dismissTour=async page=>{await expect(page.getByRole('dialog',{name:'Cómo usar la aplicación'})).toBeVisible();await page.getByRole('button',{name:'Omitir tour'}).click();};

test('guided workflow, per-requirement analysis detail, original reports and responsive layout',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await dismissTour(page);await expect(page.getByRole('heading',{name:'Requerimientos',exact:true})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(3);await expect(page.locator('body')).not.toContainText(/laureate|\bOCR\b/i);
  await page.getByRole('button',{name:'Ver requerimiento 5.3.1.14'}).click();await expect(page.locator('.considerations li')).toHaveCount(6);await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Subir fichas',exact:true}).click();await expect(page.getByRole('button',{name:/Sube la ficha del requerimiento/})).toBeVisible();await page.getByRole('button',{name:'Cerrar carga'}).click();
  await page.getByRole('button',{name:'Agregar evidencias a 5.3.1.14'}).click();
  const reqs=await (await page.request.get('/api/requirements')).json(),policy=reqs.find(r=>r.codigo==='5.3.1.14');
  await expect(page.getByLabel('Requerimiento para evidencias')).toHaveValue(policy.id);await expect(page.locator('.document-row')).toHaveCount(2);
  await expect(page.locator('.document-row').first()).toContainText('Requerimiento 5.3.1.14');
  await page.getByRole('button',{name:'Ver texto',exact:true}).first().click();await expect(page.locator('.transcription')).toContainText('POLÍTICA');await expect(page.getByRole('button',{name:'Volver a leer documento'})).toBeVisible();await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Relacionar documento existente'}).click();await expect(page.getByRole('dialog',{name:'Relacionar lineamiento con 5.3.1.14'})).toBeVisible();await expect(page.getByLabel('Documento existente').locator('option')).toHaveCount(8);await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Continuar al análisis'}).click();await expect(page.getByLabel('Seleccionar requerimiento 5.3.1.14')).toBeChecked();await expect(page.getByRole('button',{name:'Analizar documentos'})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'Seguimiento del análisis'})).toHaveCount(0);
  await page.getByRole('button',{name:'Ver análisis de 5.3.1.14'}).click();await expect(page.getByRole('dialog',{name:'Análisis del requerimiento 5.3.1.14'})).toBeVisible();await expect(page.locator('.criterion-grid>div')).toHaveCount(6);await expect(page.locator('.input-evidence')).toHaveCount(2);await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.locator('nav').getByRole('button',{name:/Resultados/}).click();await expect(page.locator('.report-card')).toHaveCount(8);
  const download=page.waitForEvent('download');await page.locator('.report-card.featured').click();expect((await download).suggestedFilename()).toBe('consolidado.xlsx');
  await page.getByRole('button',{name:'Ver detalle del análisis 3.1.1.2'}).click();await expect(page.locator('.input-evidence')).toHaveCount(1);await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Matriz de consideraciones'}).click();await expect(page.locator('.matrix-card')).toHaveCount(24);
  await page.getByLabel('Filtrar requerimiento').selectOption('5.3.1.14');await expect(page.locator('.matrix-card')).toHaveCount(6);await page.locator('.matrix-evidence').first().click();await expect(page.locator('blockquote')).not.toBeEmpty();await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/results-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('nav').getByRole('button',{name:/Requerimientos/}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Reiniciar tour'})).toBeVisible();
  const mobileAction=await page.getByRole('button',{name:'Agregar evidencias a 5.3.1.14'}).boundingBox();expect(mobileAction.x).toBeGreaterThanOrEqual(0);expect(mobileAction.x+mobileAction.width).toBeLessThanOrEqual(390);
  expect((await page.locator('.catalog-table .req-name').first().boundingBox()).width).toBeGreaterThan(200);
  await page.screenshot({path:'test-results/catalog-mobile.png',fullPage:true});expect(errors).toEqual([]);
});

test('tour explains all five screens, can restart, closes with Escape and remembers completion',async({page})=>{
  await page.goto('/');const dialog=page.getByRole('dialog',{name:'Cómo usar la aplicación'});await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('De la ficha a los resultados');await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(dialog).toContainText('1. Sube tu ficha');
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.getByRole('heading',{name:'Evidencias',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.getByRole('heading',{name:'Análisis',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Anterior',exact:true}).click();await expect(dialog).toContainText('2. Relaciona las evidencias');await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.getByRole('heading',{name:'Resultados',exact:true})).toBeVisible();await expect(dialog).toContainText('4. Consulta cada requerimiento');
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.getByRole('heading',{name:'Config IA',exact:true})).toBeVisible();await expect(dialog).toContainText('5. Mejora el análisis');
  await page.screenshot({path:'test-results/tour-desktop.png'});await page.getByRole('button',{name:'Terminar tour'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),tourKey)).toBe('done');
  await page.reload();await expect(page.getByRole('heading',{name:'Requerimientos',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Reiniciar tour'}).click();await expect(dialog).toContainText('De la ficha a los resultados');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/tour-mobile.png'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('pagination retains selections between pages, searches by number, and limits selection to ten',async({page})=>{
  const reqs=Array.from({length:13},(_,i)=>({id:`req-${i+1}`,codigo:`1.${i+1}`,ficha:{nombre_requerimiento:`1.${i+1} Requerimiento ${i+1}`,tipo:'plan',consideraciones:['Condición'],requerimientos_relacionados:[]},evidencias:1,fichas_pendientes:0,evidencias_pendientes:0}));
  await page.addInitScript(key=>localStorage.setItem(key,'done'),tourKey);
  await page.route('**/api/requirements',route=>route.fulfill({json:reqs}));await page.route('**/api/runs',route=>route.fulfill({json:[]}));await page.route('**/api/requirements/*/documents',route=>route.fulfill({json:[]}));
  await page.goto('/');await page.locator('nav').getByRole('button',{name:/Análisis/}).click();await expect(page.locator('.selection-row')).toHaveCount(10);
  await page.getByLabel('Cantidad de requerimientos a analizar por página').selectOption('5');await expect(page.locator('.selection-row')).toHaveCount(5);
  await page.getByLabel('Seleccionar requerimiento 1.1',{exact:true}).check();await page.getByRole('button',{name:'Página siguiente de requerimientos a analizar'}).click();await page.getByLabel('Seleccionar requerimiento 1.6',{exact:true}).check();await expect(page.locator('.panel-footer')).toContainText('2 seleccionados');
  await page.getByRole('button',{name:'Página anterior de requerimientos a analizar'}).click();await expect(page.getByLabel('Seleccionar requerimiento 1.1',{exact:true})).toBeChecked();await page.getByRole('button',{name:'Seleccionar esta página'}).click();await page.getByRole('button',{name:'Página siguiente de requerimientos a analizar'}).click();await page.getByRole('button',{name:'Seleccionar esta página'}).click();await expect(page.locator('.panel-footer')).toContainText('10 seleccionados');
  await page.getByRole('button',{name:'Página siguiente de requerimientos a analizar'}).click();await expect(page.getByLabel('Seleccionar requerimiento 1.11',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Página siguiente de requerimientos a analizar'})).toBeDisabled();
  await page.getByLabel('Buscar requerimientos a analizar').fill('1.13');await expect(page.locator('.selection-row')).toHaveCount(1);await expect(page.locator('.pagination')).toContainText('Página 1 de 1');await page.getByRole('button',{name:'Limpiar selección'}).click();await expect(page.getByRole('button',{name:'Analizar documentos'})).toBeDisabled();
  await page.getByLabel('Buscar requerimientos a analizar').fill('');await expect(page.locator('.selection-row')).toHaveCount(5);await page.screenshot({path:'test-results/analysis-pagination.png',fullPage:true});
});

test('ficha upload continues to its requirement and evidence submission carries its explicit lineamiento',async({page})=>{
  let reqs=[],docs=[],uploads=[];
  const req={id:'new-req',codigo:'2.3.4',documento_ficha_actual:'ficha-id',ficha:{nombre_requerimiento:'2.3.4 Plan institucional',tipo:'plan',consideraciones:['Condición'],requerimientos_relacionados:[]},evidencias:0,fichas_pendientes:0,evidencias_pendientes:0};
  await page.addInitScript(key=>localStorage.setItem(key,'done'),tourKey);await page.route('**/api/requirements',route=>route.fulfill({json:reqs}));await page.route('**/api/runs',route=>route.fulfill({json:[]}));await page.route('**/api/requirements/*/documents',route=>route.fulfill({json:docs}));
  await page.route('**/api/uploads',async route=>{const body=route.request().postData();uploads.push(body);if(body.includes('name="kind"\r\n\r\nficha'))reqs=[req];else{req.evidencias=1;docs=[{id:'doc-id',clase:'evidencia',nombre_original:'politica.txt',lineamiento:'LIN-01',activa:1,estado:'complete'}];}await route.fulfill({status:202,json:{files:[{ok:true,documentId:uploads.length===1?'ficha-id':'doc-id',requirementId:req.id}]}});});
  await page.goto('/');await page.getByRole('button',{name:'Subir fichas',exact:true}).click();await page.getByLabel('Seleccionar fichas').setInputFiles({name:'Ficha 2.3.4.txt',mimeType:'text/plain',buffer:Buffer.from('Ficha del requerimiento 2.3.4')});
  await expect(page.getByLabel('Número de Ficha 2.3.4.txt')).toHaveValue('2.3.4');await page.getByRole('button',{name:'Crear requerimiento y continuar'}).click();await expect(page.getByRole('heading',{name:'Evidencias',exact:true})).toBeVisible();await expect(page.getByLabel('Requerimiento para evidencias')).toHaveValue('new-req');
  await page.getByLabel('Seleccionar evidencias').setInputFiles({name:'politica.txt',mimeType:'text/plain',buffer:Buffer.from('Documento de evidencia')});await page.getByLabel('Lineamiento de politica.txt').fill('LIN-01');await page.getByRole('button',{name:'Cargar y relacionar evidencias'}).click();await expect(page.locator('.document-row')).toContainText('Lineamiento: LIN-01 → Requerimiento 2.3.4');
  expect(uploads[1]).toContain('name="reqId"\r\n\r\nnew-req');expect(uploads[1]).toContain('name="lineamiento"\r\n\r\nLIN-01');await page.getByRole('button',{name:'Continuar al análisis'}).click();await expect(page.getByLabel('Seleccionar requerimiento 2.3.4')).toBeChecked();
});

test('existing evidence association identifies the target requirement and shows recoverable errors in the dialog',async({page})=>{
  const req={id:'target',codigo:'4.5',documento_ficha_actual:'ficha',ficha:{nombre_requerimiento:'4.5 Plan',tipo:'plan',consideraciones:[],requerimientos_relacionados:[]},evidencias:0,fichas_pendientes:0,evidencias_pendientes:0};
  const document={id:'existing',nombre_original:'politica.txt',codigo:'1.1',lineamiento:'politica'};let docs=[],attempts=0,payload;
  await page.addInitScript(key=>localStorage.setItem(key,'done'),tourKey);await page.route('**/api/requirements',route=>route.fulfill({json:[req]}));await page.route('**/api/runs',route=>route.fulfill({json:[]}));await page.route('**/api/requirements/*/documents',route=>route.fulfill({json:docs}));await page.route('**/api/evidence-library',route=>route.fulfill({json:[document]}));
  await page.route('**/api/requirements/target/evidences',route=>{attempts++;payload=route.request().postDataJSON();if(attempts===1)return route.fulfill({status:409,json:{error:'Ese ID de lineamiento ya está usado en este requerimiento. Elige otro.'}});docs=[{...document,clase:'evidencia',estado:'complete',activa:1,compartido:1,lineamiento:payload.lineamiento}];req.evidencias=1;return route.fulfill({status:201,json:{documentId:document.id,requirementId:req.id}});});
  await page.goto('/');await page.getByRole('button',{name:'Agregar evidencias a 4.5'}).click();await page.getByRole('button',{name:'Relacionar documento existente'}).click();const dialog=page.getByRole('dialog',{name:'Relacionar lineamiento con 4.5'});await page.getByLabel('Documento existente').selectOption('existing');await expect(page.getByLabel('ID del lineamiento existente')).toHaveValue('politica');
  await page.getByRole('button',{name:'Relacionar con este requerimiento'}).click();await expect(dialog.getByRole('alert')).toContainText('Elige otro');await page.getByLabel('ID del lineamiento existente').fill('LIN-04');await page.getByRole('button',{name:'Relacionar con este requerimiento'}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.document-row')).toContainText('Lineamiento: LIN-04 → Requerimiento 4.5');expect(payload).toEqual({documentId:'existing',lineamiento:'LIN-04'});
});
