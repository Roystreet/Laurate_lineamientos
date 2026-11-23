import {test,expect} from '@playwright/test';

// Every /api call is simulated: no database and no OpenAI are needed.
function mockApi(){
  const now=new Date().toISOString();
  const finding={criterio:'Coherencia',estado:'No cumple',hallazgo:'Falta firma de aprobación',observacion:'El plan no tiene firma.',literal:'Sin firma',lineamiento:'politica'};
  const state={
    versions:[{numero:1,created_at:now,publicado_por:'Sistema',origen:'inicial',solicitud_numero:null,revertida_de:null,motivo:null,analisis:1,reglas:[],cambios:[]}],
    request:null,test:null,bodies:{},
  };
  const rule={codigo:'R-1',texto:'No exigir firma física en planes',criterios:[2],activa:true};
  const detail=()=>({...state.request,produccion_numero:state.versions[0].numero});
  const routes={
    'GET /api/requirements':()=>[{id:'r1',codigo:'5.1',documento_ficha_actual:'d1',ficha:{nombre_requerimiento:'5.1 Política de prueba',tipo:'lineamiento',consideraciones:['c'],requerimientos_relacionados:[]},evidencias:1,fichas_pendientes:0,evidencias_pendientes:0}],
    'GET /api/runs':()=>[{id:'run1',estado:'complete',error:null,created_at:now,requerimientos:1,requirementIds:['r1'],reglas_version:1}],
    'GET /api/config':()=>({parameters:{uploadMb:50,uploadFiles:20},formats:['.pdf'],maxRequirements:10,reglasVersion:state.versions[0].numero}),
    'GET /api/config-ia/versions':()=>state.versions,
    'GET /api/config-ia/rules':()=>state.versions[0].reglas.map(r=>({...r,estado:'activa',desde:2})),
    'GET /api/config-ia/requests':()=>state.request?[{...state.request,estado_visible:state.request.estado}]:[],
    'GET /api/config-ia/cases':()=>[{ejecucion_id:'run1',created_at:now,estado:'complete',reglas_version:1,criterios:[{criterio_id:2,nombre:'Coherencia',estado_tecnico:'complete',filas:[finding]}]}],
    'POST /api/config-ia/requests':(body)=>{
      state.bodies.request=body;
      state.request={id:'s1',numero:1,autor:body.autor,descripcion:body.descripcion,esperado:body.esperado,estado:'pendiente',criterio_id:2,criterio_nombre:'Coherencia',requerimiento_codigo:'5.1',requerimiento_id:'r1',ejecucion_id:'run1',created_at:now,fila_orden:0,fila_copia:finding,motivo_rechazo:null,
        borrador:{base:{numero:1,reglas:[{codigo:'R-9',texto:'Regla base',criterios:[3],activa:true}]},cambios:[],reglas:[{codigo:'R-9',texto:'Regla base',criterios:[3],activa:true}],conflictos:[],criterios_tocados:[]},pruebas:[],eventos:[{tipo:'creada',autor:body.autor,detalle:null,created_at:now}],publicacion:{ok:false,motivo:'El borrador no tiene cambios.'}};
      return {id:'s1',numero:1};
    },
    'GET /api/config-ia/requests/s1':()=>detail(),
    'PUT /api/config-ia/requests/s1/draft':(body)=>{
      state.bodies.draft=body;
      state.request.estado='en_prueba';
      state.request.borrador={...state.request.borrador,cambios:body.cambios.map(c=>({...c,codigo:'R-1'})),reglas:[rule],criterios_tocados:[2]};
      state.request.publicacion={ok:false,motivo:'Ejecuta una prueba completa del borrador.'};
      return detail();
    },
    'POST /api/config-ia/tests':(body)=>{
      state.bodies.test=body;
      state.test={id:'t1',solicitud_id:'s1',estado:'complete',exploratoria:false,veredicto:null,revisor:null,comentario:null,comparar_numero:1,base_numero:1,apagadas:[],criterios:[2],progreso:{total:2,listos:2,errores:0},tareas:[],en_espera:false,
        casos:[{codigo:'5.1',requerimiento_id:'r1',ejecucion_id:'run1',origen:true,criterios:[{criterio_id:2,nombre:'Coherencia',produccion:{estado_tecnico:'complete',origen:'reutilizado',filas:[finding]},borrador:{estado_tecnico:'complete',origen:'ejecutado',filas:[{...finding,estado:'Cumple',hallazgo:'N/A',observacion:'La validez se verifica por el pie de página.'}]}}]}]};
      state.request.pruebas=[{id:'t1',created_at:now,estado:'complete',exploratoria:false,veredicto:null,revisor:null,comentario:null}];
      return {id:'t1'};
    },
    'GET /api/config-ia/tests/t1':()=>state.test,
    'POST /api/config-ia/tests/t1/verdict':(body)=>{
      state.test={...state.test,veredicto:body.veredicto,revisor:body.revisor};
      state.request.estado='funciono';state.request.publicacion={ok:true,motivo:null};
      return state.test;
    },
    'POST /api/config-ia/requests/s1/publish':()=>{
      state.versions.unshift({numero:2,created_at:now,publicado_por:'Ana',origen:'solicitud',solicitud_numero:1,revertida_de:null,motivo:'Firma',analisis:0,reglas:[rule],cambios:[{codigo:'R-1',accion:'agregada',antes:null,despues:rule}]});
      state.request.estado='publicada';state.request.publicacion={ok:false,motivo:'La solicitud ya está cerrada.'};
      return {numero:2};
    },
  };
  return {state,routes};
}

test('Config IA: solicitud, borrador, prueba lado a lado, veredicto y publicación',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {state,routes}=mockApi();
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const handler=routes[`${request.method()} ${url.pathname}`];
    if(!handler)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:`Sin simulación: ${request.method()} ${url.pathname}`})});
    const body=request.postData()?JSON.parse(request.postData()):undefined;
    return route.fulfill({status:request.method()==='POST'&&url.pathname.endsWith('/tests')?202:200,contentType:'application/json',body:JSON.stringify(handler(body))});
  });
  await page.addInitScript(()=>{try{localStorage.setItem('documental:tour:v1','done');}catch{/* ignore */}});
  await page.goto('/');
  await page.locator('nav').getByRole('button',{name:/Config IA/}).click();
  await expect(page.getByRole('heading',{name:'Config IA',exact:true})).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByText('Versión en producción:')).toContainText('v1');

  await page.getByRole('tab',{name:'Solicitudes'}).click();
  await page.getByRole('button',{name:'Nueva solicitud'}).click();
  const create=page.getByRole('dialog',{name:'Nueva solicitud de mejora'});
  await create.getByLabel('Tu nombre').fill('Ana');
  await create.getByLabel('Requerimiento del hallazgo').selectOption('r1');
  await create.getByLabel('Análisis del hallazgo').selectOption('run1');
  await create.getByLabel('Criterio del hallazgo').selectOption('2');
  await create.getByRole('radio',{name:/Falta firma de aprobación/}).check();
  await create.getByLabel('¿Qué está mal?').fill('No debe exigir firma física');
  await create.getByRole('button',{name:'Crear solicitud'}).click();
  expect(state.bodies.request).toMatchObject({autor:'Ana',requerimientoId:'r1',ejecucionId:'run1',criterioId:2,filaOrden:0});

  const detail=page.getByRole('dialog',{name:'Solicitud #1'});
  await expect(detail).toContainText('Falta firma de aprobación');
  // Edit a production rule: the change must carry the rule as it was shown (antes).
  await detail.locator('li',{hasText:'R-9'}).getByRole('button',{name:'Editar'}).click();
  await detail.getByLabel('Texto de la regla').fill('Regla base editada');
  await detail.getByLabel('Motivo del cambio').fill('Ajuste');
  await detail.getByRole('button',{name:'Aplicar al borrador'}).click();
  // Add a rule, then edit it before saving: it must stay a single change.
  await detail.getByRole('button',{name:'Agregar regla'}).click();
  await detail.getByLabel('Texto de la regla').fill('No exigir firma');
  await detail.getByLabel('Motivo del cambio').fill('Firma');
  await detail.getByRole('button',{name:'Aplicar al borrador'}).click();
  await detail.locator('li',{hasText:'No exigir firma'}).getByRole('button',{name:'Editar'}).click();
  await detail.getByLabel('Texto de la regla').fill('No exigir firma física en planes');
  await detail.getByRole('button',{name:'Aplicar al borrador'}).click();
  await detail.getByRole('button',{name:'Guardar borrador'}).click();
  await expect(detail).toContainText('R-1');
  expect(state.bodies.draft.autor).toBe('Ana');
  expect(state.bodies.draft.cambios).toHaveLength(2);
  expect(state.bodies.draft.cambios).toEqual(expect.arrayContaining([
    expect.objectContaining({op:'crear',texto:'No exigir firma física en planes',criterios:[2],motivo:'Firma'}),
    expect.objectContaining({op:'modificar',codigo:'R-9',texto:'Regla base editada',antes:{texto:'Regla base',criterios:[3],activa:true}}),
  ]));

  await detail.getByRole('button',{name:'Probar en el playground'}).click();
  await expect(page.getByText('Solicitud #1 · 5.1 · Coherencia')).toBeVisible();
  await page.getByRole('button',{name:'Ejecutar prueba'}).click();
  expect(state.bodies.test).toMatchObject({solicitudId:'s1',criterios:[2],apagadas:[],casos:[{requerimientoId:'r1',ejecucionId:'run1'}]});
  await expect(page.locator('.cia-sbs-col')).toHaveCount(2);
  await expect(page.locator('.cia-sbs-col').first()).toContainText('Producción v1');
  await expect(page.locator('.cia-sbs-col').nth(1)).toContainText('Borrador');
  await expect(page.locator('.cia-sbs-col').first()).toContainText('Reutilizado del análisis original');

  await page.getByRole('button',{name:'Funcionó',exact:true}).click();
  await page.getByRole('button',{name:'Publicar como v2'}).click();
  await expect(page.getByText('Versión en producción:')).toContainText('v2');
  await page.getByRole('tab',{name:'Historial'}).click();
  await expect(page.locator('.cia-versions>li').first()).toContainText('Solicitud #1');

  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:'Reglas'}).click();
  await expect(page.locator('.cia-rule-text').first()).toContainText('No exigir firma física');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/config-ia-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

// ---- Regla sugerida por IA: request #1 (base rule R-9) and its suggestion g1, both simulated. ----
const NOW=new Date().toISOString();
const FINDING={criterio:'Coherencia',estado:'No cumple',hallazgo:'Falta firma de aprobación',observacion:'El plan no tiene firma.',literal:'Sin firma',lineamiento:'politica'};
const BASE_RULES=[{codigo:'R-9',texto:'Regla base',criterios:[3],activa:true}];
const PROPOSAL={entendimiento:'No se debe exigir firma física.',regla:{cuando:'el plan tiene código',hacer:'no exigir firma',excepto:null,texto:'No exigir firma física si el plan tiene código.',criterios:[2],motivo:'La validez se verifica por código.'},
  choques:[{codigo:'R-9',origen:'produccion',solicitud_numero:null,tipo:'se_solapa',explicacion:'R-9 trata un tema parecido.',ajuste:{texto:'Regla base ajustada',criterios:[3],motivo:'Unificar'}}],
  recomendacion:'R-9',advertencias:[{tipo:'problema_de_entrada',explicacion:'El texto de la firma no se leyó bien.'}]};
const suggestionOf=(extra={})=>({id:'g1',estado:'lista',desactualizada:false,error:null,autor:'Ana',indicacion:null,created_at:NOW,propuesta:PROPOSAL,aprobaciones:[],...extra});
const requestOf=({autor='Ana',descripcion='No debe exigir firma física',esperado=''}={})=>({id:'s1',numero:1,autor,descripcion,esperado,estado:'pendiente',criterio_id:2,criterio_nombre:'Coherencia',requerimiento_codigo:'5.1',requerimiento_id:'r1',ejecucion_id:'run1',created_at:NOW,fila_orden:0,fila_copia:FINDING,motivo_rechazo:null,
  borrador:{base:{numero:1,reglas:BASE_RULES},cambios:[],reglas:BASE_RULES,conflictos:[],criterios_tocados:[]},pruebas:[],eventos:[],publicacion:{ok:false,motivo:'El borrador no tiene cambios.'}});

/**
 * Simulates the API with the real contract (approving answers the request detail with the suggestion 'aprobada'
 * and an approval {opcion, codigo, editada, texto, criterios, motivo, autor, fecha}) and opens the Solicitudes tab.
 * Setting `state.fail` to {status, error} makes the next approval or "Pedir otra" fail once.
 */
async function mockSuggestionApi(page,{request=null,sugerencia=null,propuesta=PROPOSAL}={}){
  const state={request,sugerencia,bodies:{},fail:null};
  const failOnce=()=>{const f=state.fail;state.fail=null;if(f)throw f;};
  const detail=()=>({...state.request,sugerencia:state.sugerencia,produccion_numero:1});
  const routes={
    'GET /api/requirements':()=>[{id:'r1',codigo:'5.1',documento_ficha_actual:'d1',ficha:{nombre_requerimiento:'5.1 Política de prueba',tipo:'lineamiento',consideraciones:['c'],requerimientos_relacionados:[]},evidencias:1,fichas_pendientes:0,evidencias_pendientes:0}],
    'GET /api/runs':()=>[{id:'run1',estado:'complete',error:null,created_at:NOW,requerimientos:1,requirementIds:['r1'],reglas_version:1}],
    'GET /api/config':()=>({parameters:{uploadMb:50,uploadFiles:20},formats:['.pdf'],maxRequirements:10,reglasVersion:1}),
    'GET /api/config-ia/versions':()=>[{numero:1,created_at:NOW,publicado_por:'Sistema',origen:'inicial',solicitud_numero:null,revertida_de:null,motivo:null,analisis:1,reglas:[],cambios:[]}],
    'GET /api/config-ia/rules':()=>[],
    'GET /api/config-ia/requests':()=>state.request?[{...state.request,estado_visible:state.request.estado}]:[],
    'GET /api/config-ia/cases':()=>[{ejecucion_id:'run1',created_at:NOW,estado:'complete',reglas_version:1,criterios:[{criterio_id:2,nombre:'Coherencia',estado_tecnico:'complete',filas:[FINDING]}]}],
    'POST /api/config-ia/requests':(body)=>{state.request=requestOf(body);return {id:'s1',numero:1,sugerenciaId:'g1'};},
    'GET /api/config-ia/requests/s1':()=>detail(),
    // A suggestion being generated is ready on the next check.
    'GET /api/config-ia/requests/s1/suggestion':()=>{if(state.sugerencia?.estado==='generando')state.sugerencia=suggestionOf({propuesta});return {sugerencia:state.sugerencia};},
    'POST /api/config-ia/suggestions/g1/approve':(body)=>{
      state.bodies.approve=body;failOnce();
      const option=body.opcion==='regla_nueva'?propuesta.regla:propuesta.choques.find(c=>c.codigo===body.opcion&&c.ajuste).ajuste;
      const {texto=option.texto,criterios=option.criterios,motivo=option.motivo}=body;
      const editada=texto!==option.texto||String(criterios)!==String(option.criterios)||motivo!==option.motivo;
      const codigo=body.opcion==='regla_nueva'?'R-10':body.opcion;
      const change=body.opcion==='regla_nueva'?{op:'crear',codigo,texto,criterios}:{op:'modificar',codigo,texto,criterios,activa:true,antes:{texto:'Regla base',criterios:[3],activa:true}};
      state.request={...state.request,estado:'en_prueba',borrador:{...state.request.borrador,cambios:[...state.request.borrador.cambios,{...change,motivo,autor:body.autor,sugerencia_id:'g1'}]}};
      state.sugerencia={...state.sugerencia,estado:'aprobada',aprobaciones:[...state.sugerencia.aprobaciones,{opcion:body.opcion,codigo,editada,texto,criterios,motivo,autor:body.autor,fecha:NOW}]};
      return detail();
    },
    'POST /api/config-ia/suggestions/g1/discard':(body)=>{state.bodies.discard=body;state.sugerencia={...state.sugerencia,estado:'descartada'};return detail();},
    'POST /api/config-ia/requests/s1/suggestions':(body)=>{state.bodies.again=body;failOnce();state.sugerencia={...state.sugerencia,estado:'generando',propuesta:null};return {id:'g1'};},
  };
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const handler=routes[`${req.method()} ${url.pathname}`];
    if(!handler)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:`Sin simulación: ${req.method()} ${url.pathname}`})});
    const body=req.postData()?JSON.parse(req.postData()):undefined;
    let answer;
    try{answer=handler(body);}catch(f){return route.fulfill({status:f.status,contentType:'application/json',body:JSON.stringify({error:f.error})});}
    return route.fulfill({status:req.method()==='POST'&&url.pathname.endsWith('/suggestions')?202:200,contentType:'application/json',body:JSON.stringify(answer)});
  });
  await page.addInitScript(()=>{try{localStorage.setItem('documental:tour:v1','done');}catch{/* ignore */}});
  await page.goto('/');
  await page.locator('nav').getByRole('button',{name:/Config IA/}).click();
  await page.getByRole('tab',{name:'Solicitudes'}).click();
  return state;
}

/** Opens the simulated request #1 and writes the author's name. */
async function openRequest(page){
  await page.getByRole('button',{name:'Abrir solicitud 1'}).click();
  const dialog=page.getByRole('dialog',{name:'Solicitud #1'});
  await dialog.getByLabel('Tu nombre').fill('Ana');
  return dialog;
}

test('Config IA: regla sugerida por IA con choque y aprobación del ajuste',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await mockSuggestionApi(page,{sugerencia:suggestionOf({estado:'generando',propuesta:null})});
  await page.getByRole('button',{name:'Nueva solicitud'}).click();
  const create=page.getByRole('dialog',{name:'Nueva solicitud de mejora'});
  await expect(create).toContainText('La IA usará esto para sugerir la regla.');
  await create.getByLabel('Tu nombre').fill('Ana');
  await create.getByLabel('Requerimiento del hallazgo').selectOption('r1');
  await create.getByLabel('Análisis del hallazgo').selectOption('run1');
  await create.getByLabel('Criterio del hallazgo').selectOption('2');
  await create.getByRole('radio',{name:/Falta firma de aprobación/}).check();
  await create.getByLabel('¿Qué está mal?').fill('No debe exigir firma física');
  await create.getByRole('button',{name:'Crear solicitud'}).click();

  const detailDialog=page.getByRole('dialog',{name:'Solicitud #1'});
  await expect(detailDialog).toContainText('Generando sugerencia…');
  await expect(detailDialog).toContainText('Regla sugerida por IA');
  await expect(detailDialog).toContainText('Parece un problema de lectura del documento');
  await expect(detailDialog).toContainText('Recomendada');
  await detailDialog.getByRole('button',{name:'Aprobar ajuste de R-9',exact:true}).click();
  await expect.poll(()=>state.bodies.approve).toEqual({autor:'Ana',opcion:'R-9'});
  await expect(detailDialog.getByRole('button',{name:'Aprobar ajuste de R-9',exact:true})).toHaveCount(0);
  await expect(detailDialog.getByRole('button',{name:'Aprobar',exact:true})).toBeVisible();
  await expect(detailDialog.getByText('Aprobada',{exact:true}).first()).toBeVisible();
  await expect(detailDialog.locator('li',{hasText:'R-9'}).filter({hasText:'Sugerida por IA'}).first()).toBeVisible();

  await detailDialog.getByLabel('Indicación para la IA (opcional)').fill('más específica');
  await detailDialog.getByRole('button',{name:'Pedir otra'}).click();
  await expect.poll(()=>state.bodies.again).toEqual({autor:'Ana',indicacion:'más específica'});

  await page.setViewportSize({width:390,height:844});
  await expect(detailDialog).toContainText('Regla sugerida por IA');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Config IA: editar y aprobar un ajuste; la tarjeta resume lo aprobado',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // R-9 is also edited by another open request: that clash only warns; the adjustment is production's R-9.
  const propuesta={...PROPOSAL,choques:[{codigo:'R-9',origen:'otra_solicitud',solicitud_numero:2,tipo:'se_solapa',explicacion:'El borrador #2 también edita R-9.',ajuste:null},...PROPOSAL.choques]};
  const state=await mockSuggestionApi(page,{request:requestOf(),sugerencia:suggestionOf({propuesta}),propuesta});
  const dialog=await openRequest(page);
  const card=dialog.locator('.cia-suggestion');
  const other=card.locator('.cia-option',{hasText:'(borrador #2)'}),own=card.locator('.cia-option',{hasText:'(producción)'});
  await expect(other).toContainText('El borrador #2 también edita R-9.');
  await expect(other).not.toContainText('Recomendada');
  await expect(other.getByRole('button')).toHaveCount(0);
  await expect(own).toContainText('Recomendada');
  await expect(card.getByRole('button',{name:'Aprobar ajuste de R-9',exact:true})).toHaveCount(1);

  await card.getByRole('button',{name:'Editar y aprobar ajuste de R-9'}).click();
  await expect(card.getByLabel('Texto sugerido')).toHaveValue('Regla base ajustada');
  await card.getByLabel('Texto sugerido').fill('Valida la firma por el pie de página');
  await card.getByRole('checkbox',{name:'Coherencia'}).check();
  await card.getByLabel('Motivo sugerido').fill('Unificar con la firma');
  // The server refuses it: the error is shown and the form keeps what was typed.
  state.fail={status:409,error:'La regla R-9 ya no está disponible; pide otra sugerencia.'};
  await card.getByRole('button',{name:'Confirmar aprobación'}).click();
  await expect(page.locator('[role=alert]')).toContainText('La regla R-9 ya no está disponible; pide otra sugerencia.');
  await expect(card.getByLabel('Texto sugerido')).toHaveValue('Valida la firma por el pie de página');
  await card.getByRole('button',{name:'Confirmar aprobación'}).click();
  await expect.poll(()=>state.bodies.approve).toEqual({autor:'Ana',opcion:'R-9',texto:'Valida la firma por el pie de página',criterios:[2,3],motivo:'Unificar con la firma'});

  // The card shows what was approved (edited), not the AI's original text.
  await expect(card.getByLabel('Texto sugerido')).toHaveCount(0);
  await expect(own).toContainText('Aprobada');
  await expect(own).toContainText('(editada)');
  await expect(own).toContainText('Valida la firma por el pie de página');
  await expect(own).toContainText('Unificar con la firma');
  await expect(own).not.toContainText('Regla base ajustada');
  await expect(own.getByRole('button')).toHaveCount(0);
  await expect(other).not.toContainText('Aprobada');
  await expect(dialog.locator('li',{hasText:'Valida la firma por el pie de página'}).filter({hasText:'Sugerida por IA'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('Config IA: descartar la sugerencia la oculta y conserva los cambios sin guardar del borrador',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await mockSuggestionApi(page,{request:requestOf(),sugerencia:suggestionOf()});
  const dialog=await openRequest(page);
  await dialog.locator('li',{hasText:'R-9'}).getByRole('button',{name:'Editar'}).click();
  await dialog.getByLabel('Texto de la regla').fill('Regla base cambiada a mano');
  await dialog.getByLabel('Motivo del cambio').fill('Ajuste');
  await dialog.getByRole('button',{name:'Aplicar al borrador'}).click();
  await expect(dialog).toContainText('Hay cambios sin guardar.');
  await expect(dialog).toContainText('Guarda o descarta los cambios del borrador antes de aprobar.');
  await expect(dialog.getByRole('button',{name:'Aprobar ajuste de R-9',exact:true})).toBeDisabled();

  await dialog.getByRole('button',{name:'Descartar',exact:true}).click();
  await expect.poll(()=>state.bodies.discard).toEqual({autor:'Ana'});
  await expect(dialog.locator('.cia-suggestion')).toHaveCount(0);
  await expect(dialog.locator('li',{hasText:'R-9'})).toContainText('Regla base cambiada a mano');
  await expect(dialog).toContainText('Hay cambios sin guardar.');
  expect(errors).toEqual([]);
});

test('Config IA: sugerencia con error muestra el mensaje y Pedir otra; si falla, conserva la indicación',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await mockSuggestionApi(page,{request:requestOf(),sugerencia:suggestionOf({estado:'error',error:'La IA no devolvió una sugerencia válida. Pide otra o escribe la regla a mano.',propuesta:null})});
  const dialog=await openRequest(page);
  const card=dialog.locator('.cia-suggestion');
  await expect(card).toContainText('La IA no devolvió una sugerencia válida. Pide otra o escribe la regla a mano.');
  await expect(card.getByRole('button',{name:'Pedir otra'})).toBeEnabled();

  await card.getByLabel('Indicación para la IA (opcional)').fill('más corta');
  state.fail={status:409,error:'Ya se está generando una sugerencia.'};
  await card.getByRole('button',{name:'Pedir otra'}).click();
  await expect(page.locator('[role=alert]')).toContainText('Ya se está generando una sugerencia.');
  await expect(card.getByLabel('Indicación para la IA (opcional)')).toHaveValue('más corta');
  await card.getByRole('button',{name:'Pedir otra'}).click();
  await expect.poll(()=>state.bodies.again).toEqual({autor:'Ana',indicacion:'más corta'});
  await expect(card.getByLabel('Indicación para la IA (opcional)')).toHaveValue('');
  await expect(card).toContainText('Entendí: No se debe exigir firma física.');
  expect(errors).toEqual([]);
});

test('Config IA: sugerencia aprobada y desactualizada aclara que lo aprobado sigue en el borrador',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const aprobacion={opcion:'R-9',codigo:'R-9',editada:false,texto:'Regla base ajustada',criterios:[3],motivo:'Unificar',autor:'Ana',fecha:NOW};
  await mockSuggestionApi(page,{request:requestOf(),sugerencia:suggestionOf({estado:'aprobada',desactualizada:true,aprobaciones:[aprobacion]})});
  const dialog=await openRequest(page);
  const card=dialog.locator('.cia-suggestion');
  await expect(card).toContainText('Producción cambió. Lo que aprobaste sigue en el borrador; para otra opción, pide otra sugerencia.');
  await expect(card).not.toContainText('Producción cambió; pide otra sugerencia.');
  await expect(card.getByRole('button',{name:'Aprobar',exact:true})).toHaveCount(0);
  await expect(card.getByRole('button',{name:'Pedir otra'})).toBeVisible();
  expect(errors).toEqual([]);
});
