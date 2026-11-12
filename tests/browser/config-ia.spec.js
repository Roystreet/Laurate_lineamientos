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
        borrador:{base:{numero:1,reglas:[]},cambios:[],reglas:[],conflictos:[],criterios_tocados:[]},pruebas:[],eventos:[{tipo:'creada',autor:body.autor,detalle:null,created_at:now}],publicacion:{ok:false,motivo:'El borrador no tiene cambios.'}};
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
  await detail.getByRole('button',{name:'Agregar regla'}).click();
  await detail.getByLabel('Texto de la regla').fill('No exigir firma física en planes');
  await detail.getByLabel('Motivo del cambio').fill('Firma');
  await detail.getByRole('button',{name:'Aplicar al borrador'}).click();
  await detail.getByRole('button',{name:'Guardar borrador'}).click();
  await expect(detail).toContainText('R-1');
  expect(state.bodies.draft).toMatchObject({autor:'Ana',cambios:[{op:'crear',texto:'No exigir firma física en planes',criterios:[2],motivo:'Firma'}]});

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
