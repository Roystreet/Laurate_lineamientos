import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../src/platform/server.js';
import { pool, migrate, query, transaction } from '../../src/platform/db.js';
import { production, insertVersion, allocateRuleCode, listVersions, ruleHistory, republish, listRules } from '../../src/platform/config-ia/versions.js';
import { casesFor, createRequest, requestDetail, saveDraft, rejectRequest, listRequests, publishRequest } from '../../src/platform/config-ia/requests.js';
import { createTest, testDetail, recordVerdict } from '../../src/platform/config-ia/playground.js';
import { claim, settle } from '../../src/platform/queue.js';
import { processTask } from '../../src/platform/processor.js';
import { fakeLlm, seedAnalyzed, seedPrepared, drain } from './helpers.js';

let app;
before(async () => { await migrate(); await migrate(); app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });

const lock = (c) => query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE', [], c);
async function publishRules(reglas, autor = 'Ana') {
  return transaction(async (c) => { await lock(c); return insertVersion({ reglas, origen: 'solicitud', autor }, c); });
}

test('versiones: v1 inicial, análisis congela versión, reglas llegan al prompt, republicar', async () => {
  const versions = await query('SELECT numero, reglas FROM ia_versiones');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].numero, 1);
  assert.deepEqual(typeof versions[0].reglas === 'string' ? JSON.parse(versions[0].reglas) : versions[0].reglas, []);

  const calls = [], llm = fakeLlm(calls);
  const first = await seedAnalyzed(app, '7.1.1', llm);
  assert.equal((await app.inject(`/api/runs/${first.runId}`)).json().reglas_version, 1);
  assert.ok(!calls.some((c) => c.system.includes('REGLAS ADICIONALES')));

  const codigo = await transaction(async (c) => allocateRuleCode(c));
  assert.equal(codigo, 'R-1');
  assert.equal((await publishRules([{ codigo, texto: 'No exigir firmas', criterios: [2], activa: true }])).numero, 2);
  assert.equal((await production()).numero, 2);

  calls.length = 0;
  const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { requirementIds: [first.reqId] } });
  await drain(llm);
  assert.equal((await app.inject(`/api/runs/${run.json().id}`)).json().reglas_version, 2);
  assert.ok(calls.find((c) => c.system.includes('CRITERIO A EVALUAR: Coherencia')).system.endsWith('- [R-1] No exigir firmas'));
  assert.ok(!calls.find((c) => c.system.includes('CRITERIO A EVALUAR: Consistencia')).system.includes('REGLAS ADICIONALES'));
  assert.ok((await app.inject('/api/runs')).json().some((r) => r.reglas_version === 2));

  const listed = await listVersions();
  assert.equal(listed[0].numero, 2);
  assert.deepEqual(listed[0].cambios.map((c) => [c.codigo, c.accion]), [['R-1', 'agregada']]);
  assert.equal(listed[0].analisis, 1);
  assert.equal((await ruleHistory('R-1'))[0].autor, 'Ana');
  assert.equal((await ruleHistory('R-1'))[0].version_numero, 2);

  assert.equal((await republish(1, { autor: 'Luis', motivo: 'Volver' })).numero, 3);
  const v3 = (await listVersions())[0];
  assert.equal(v3.origen, 'reversion');
  assert.equal(v3.revertida_de, 1);
  assert.deepEqual((await production()).reglas, []);
  await assert.rejects(republish(1, { autor: 'Luis', motivo: '' }), (e) => e.statusCode === 400);
  await assert.rejects(republish(99, { autor: 'Luis', motivo: 'x' }), (e) => e.statusCode === 404);

  const rules = await listRules({});
  assert.equal(rules.length, 1);
  assert.equal(rules[0].estado, 'inactiva');
  assert.equal(rules[0].desde, 2);
  assert.deepEqual(await listRules({ estado: 'activa' }), []);
  assert.equal((await listRules({ criterio: 2, q: 'firmas' })).length, 1);
  assert.equal((await listRules({ criterio: 3 })).length, 0);
});

test('solicitudes: liga a hallazgo, copia de fila, borrador y conflictos', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.2.1', llm);
  const cases = await casesFor(reqId);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].ejecucion_id, runId);
  assert.equal(cases[0].criterios.length, 6);
  const base = { autor: 'Luis', descripcion: 'Marca la falta de firma', esperado: 'No marcar firmas', ejecucionId: runId, requerimientoId: reqId };

  const s = await createRequest({ ...base, criterioId: 2, filaOrden: 0 });
  let d = await requestDetail(s.id);
  assert.equal(d.numero, s.numero);
  assert.equal(d.estado, 'pendiente');
  assert.equal(d.requerimiento_codigo, '7.2.1');
  assert.equal(d.criterio_nombre, 'Coherencia');
  assert.equal(d.fila_copia.criterio, 'Coherencia');
  await query("UPDATE resultados_criterio SET filas='[]' WHERE ejecucion_id=? AND criterio_id=2", [runId]);
  assert.equal((await requestDetail(s.id)).fila_copia.criterio, 'Coherencia');

  const missing = await createRequest({ ...base, criterioId: 3 });
  assert.equal((await requestDetail(missing.id)).fila_copia, null);
  await assert.rejects(createRequest({ ...base, criterioId: 9 }), (e) => e.statusCode === 404);
  await assert.rejects(createRequest({ ...base, criterioId: 3, filaOrden: 5 }), (e) => e.statusCode === 400);
  await assert.rejects(createRequest({ ...base, criterioId: 3, descripcion: ' ' }), (e) => e.statusCode === 400);
  await assert.rejects(createRequest({ ...base, criterioId: 3, autor: '' }), (e) => e.statusCode === 400);

  d = await saveDraft(s.id, { autor: 'Ana', cambios: [{ op: 'crear', texto: 'No exigir firma física', criterios: [2], motivo: 'Firma' }] });
  assert.match(d.borrador.cambios[0].codigo, /^R-\d+$/);
  assert.equal(d.borrador.cambios[0].autor, 'Ana');
  assert.equal(d.estado, 'en_prueba');
  assert.deepEqual(d.borrador.criterios_tocados, [2]);
  assert.equal(d.borrador.reglas.find((r) => r.codigo === d.borrador.cambios[0].codigo).texto, 'No exigir firma física');
  assert.ok(d.eventos.some((e) => e.tipo === 'borrador_guardado'));

  const code = await transaction(async (c) => allocateRuleCode(c));
  await publishRules([...(await production()).reglas, { codigo: code, texto: 'Original', criterios: [3], activa: true }]);
  d = await saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x' }] });
  assert.equal(d.borrador.cambios[0].antes.texto, 'Original');
  assert.deepEqual(d.borrador.conflictos, []);
  await publishRules((await production()).reglas.map((r) => (r.codigo === code ? { ...r, texto: 'Cambiada por otro' } : r)), 'Otro');
  d = await requestDetail(missing.id);
  assert.equal(d.borrador.base.numero, (await production()).numero);
  assert.equal(d.borrador.conflictos[0].codigo, code);
  assert.equal(d.publicacion.motivo, 'Resuelve los conflictos del borrador.');
  d = await saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x' }] });
  assert.deepEqual(d.borrador.conflictos, []);

  await assert.rejects(rejectRequest(s.id, { autor: 'Ana', motivo: '' }), (e) => e.statusCode === 400);
  await rejectRequest(s.id, { autor: 'Ana', motivo: 'No aplica' });
  assert.equal((await requestDetail(s.id)).estado, 'rechazada');
  await assert.rejects(saveDraft(s.id, { autor: 'Ana', cambios: [] }), (e) => e.statusCode === 409);
  const list = await listRequests();
  assert.ok(list.some((r) => r.id === s.id && r.estado_visible === 'rechazada' && r.requerimiento_codigo === '7.2.1'));
});

async function requestWithRule(reqId, runId, criterios = [2]) {
  const s = await createRequest({ autor: 'Luis', descripcion: 'Hallazgo incorrecto', ejecucionId: runId, requerimientoId: reqId, criterioId: criterios[0], filaOrden: 0 });
  const d = await saveDraft(s.id, { autor: 'Ana', cambios: [{ op: 'crear', texto: 'Regla de prueba', criterios, motivo: 'Probar' }] });
  return { id: s.id, codigo: d.borrador.cambios[0].codigo };
}
const counts = async () => Object.fromEntries(await Promise.all(['resultados_criterio', 'hallazgos', 'reportes', 'ejecuciones'].map(async (t) => [t, (await query(`SELECT COUNT(*) n FROM ${t}`))[0].n])));

test('playground: lado a lado, reutilización y aislamiento', async () => {
  const calls = [], llm = fakeLlm(calls);
  const { reqId, runId } = await seedAnalyzed(app, '7.3.1', llm);
  const s = await requestWithRule(reqId, runId);
  const before = await counts();
  await assert.rejects(createTest({ solicitudId: s.id, autor: 'Ana', casos: [] }), (e) => e.statusCode === 400 && e.message === 'Selecciona entre 1 y 10 casos.');
  await assert.rejects(createTest({ solicitudId: s.id, autor: 'Ana', casos: Array.from({ length: 11 }, () => ({ ejecucionId: runId, requerimientoId: reqId })) }), (e) => e.statusCode === 400);

  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
  await assert.rejects(recordVerdict(t.id, { revisor: 'Luis', veredicto: 'funciono' }), (e) => e.statusCode === 409 && e.message === 'Espera a que termine la prueba.');
  calls.length = 0;
  await drain(llm);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].system.includes('CRITERIO A EVALUAR: Coherencia'));
  let d = await testDetail(t.id);
  assert.equal(d.estado, 'complete');
  assert.equal(d.exploratoria, false);
  assert.deepEqual(d.criterios, [2]);
  assert.deepEqual(d.progreso, { total: 2, listos: 2, errores: 0 });
  assert.equal(d.casos[0].origen, true);
  assert.equal(d.casos[0].codigo, '7.3.1');
  const c2 = d.casos[0].criterios.find((c) => c.criterio_id === 2);
  assert.equal(d.casos[0].criterios.length, 1);
  assert.equal(c2.nombre, 'Coherencia');
  assert.equal(c2.produccion.origen, 'reutilizado');
  assert.equal(c2.produccion.filas[0].estado, 'Cumple');
  assert.equal(c2.borrador.origen, 'ejecutado');
  assert.equal(c2.borrador.filas[0].estado, 'No cumple');
  assert.deepEqual(await counts(), before);
  assert.equal((await requestDetail(s.id)).estado, 'en_prueba');
  await assert.rejects(recordVerdict(t.id, { revisor: 'Luis', veredicto: 'quizas' }), (e) => e.statusCode === 400);
  d = await recordVerdict(t.id, { revisor: 'Luis', veredicto: 'funciono', comentario: 'Bien' });
  assert.equal(d.veredicto, 'funciono');
  assert.equal((await requestDetail(s.id)).estado, 'funciono');

  const ex = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }], apagadas: [s.codigo] });
  await drain(llm);
  assert.equal((await testDetail(ex.id)).exploratoria, true);
  await recordVerdict(ex.id, { revisor: 'Luis', veredicto: 'no_funciono' });
  assert.equal((await requestDetail(s.id)).estado, 'funciono');
  assert.equal((await requestDetail(s.id)).publicacion.ok, true);
});

test('playground: no reutiliza resultados con error', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.3.2', llm);
  const s = await requestWithRule(reqId, runId);
  await query("UPDATE resultados_criterio SET estado_tecnico='error' WHERE ejecucion_id=? AND criterio_id=2", [runId]);
  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
  assert.equal((await query("SELECT COUNT(*) n FROM ia_pruebas_resultados WHERE prueba_id=? AND lado='produccion'", [t.id]))[0].n, 0);
  await drain(llm);
  const c2 = (await testDetail(t.id)).casos[0].criterios[0];
  assert.equal(c2.produccion.origen, 'ejecutado');
  assert.equal(c2.produccion.estado_tecnico, 'complete');
});

test('playground: espera turno y no bloquea análisis', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.3.3', llm);
  const other = await seedPrepared(app, '7.3.4', llm);
  const s = await requestWithRule(reqId, runId);
  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
  const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { requirementIds: [other] } });
  assert.equal(run.statusCode, 202);
  assert.equal((await testDetail(t.id)).en_espera, true);
  const task = await claim();
  assert.equal(task.tipo, 'analyze');
  await processTask(task, { llm });
  await settle(task);
  await drain(llm);
  assert.equal((await testDetail(t.id)).estado, 'complete');
  assert.equal((await app.inject(`/api/runs/${run.json().id}`)).json().estado, 'complete');
});

test('publicar: condiciones, carrera y reprueba de otros borradores', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.4.1', llm);
  const tested = async (s) => {
    const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
    await drain(llm);
    await recordVerdict(t.id, { revisor: 'Luis', veredicto: 'funciono' });
  };
  const A = await requestWithRule(reqId, runId), B = await requestWithRule(reqId, runId);
  await assert.rejects(publishRequest(A.id, { autor: 'Ana' }), (e) => e.statusCode === 409 && e.message === 'Ejecuta una prueba completa del borrador.');
  await tested(A); await tested(B);
  const before = (await production()).numero;
  assert.equal((await publishRequest(A.id, { autor: 'Marta' })).numero, before + 1);
  assert.equal((await requestDetail(A.id)).estado, 'publicada');
  const history = await ruleHistory(A.codigo);
  assert.equal(history[0].autor, 'Ana');
  assert.equal(history[0].accion, 'agregada');
  assert.equal((await listVersions())[0].publicado_por, 'Marta');
  await assert.rejects(publishRequest(A.id, { autor: 'Ana' }), (e) => e.statusCode === 409 && e.message === 'La solicitud ya está cerrada.');

  await assert.rejects(publishRequest(B.id, { autor: 'Ana' }), (e) => e.statusCode === 409 && e.message === 'Producción cambió; vuelve a probar.');
  assert.equal((await listRequests()).find((r) => r.id === B.id).estado_visible, 'requiere_reprueba');
  await tested(B);
  assert.equal((await publishRequest(B.id, { autor: 'Luis' })).numero, before + 2);

  const C = await requestWithRule(reqId, runId);
  await tested(C);
  await saveDraft(C.id, { autor: 'Ana', cambios: [{ op: 'crear', codigo: C.codigo, texto: 'Otro texto', criterios: [2], motivo: 'x' }] });
  await assert.rejects(publishRequest(C.id, { autor: 'Ana' }), (e) => e.statusCode === 409 && e.message === 'El borrador cambió después de la prueba; vuelve a probar.');

  const D = await requestWithRule(reqId, runId), E = await requestWithRule(reqId, runId);
  await tested(D); await tested(E);
  const raced = await Promise.allSettled([publishRequest(D.id, { autor: 'Ana' }), publishRequest(E.id, { autor: 'Ana' })]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(raced.find((r) => r.status === 'rejected').reason.statusCode, 409);
  assert.equal((await production()).numero, before + 3);
});

test('API config-ia: flujo completo por HTTP', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.5.1', llm);
  const j = (r) => r.json();
  const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
  const cfg = j(await app.inject('/api/config'));
  assert.equal(cfg.reglasVersion, (await production()).numero);
  assert.equal(j(await app.inject(`/api/runs/${runId}`)).reglas_version, cfg.reglasVersion);
  const cases = await app.inject(`/api/config-ia/cases?requirementId=${reqId}`);
  assert.equal(cases.statusCode, 200);
  assert.equal(j(cases)[0].ejecucion_id, runId);

  const body = { autor: 'Luis', descripcion: 'Mal', ejecucionId: runId, requerimientoId: reqId, criterioId: 2, filaOrden: 0 };
  let r = await post('/api/config-ia/requests', { ...body, autor: '' });
  assert.equal(r.statusCode, 400);
  assert.match(j(r).error, /nombre/);
  assert.equal((await post('/api/config-ia/requests', body, { origin: 'http://otro.example' })).statusCode, 403);
  r = await post('/api/config-ia/requests', body);
  assert.equal(r.statusCode, 201);
  const sid = j(r).id;
  assert.equal((await app.inject('/api/config-ia/requests')).statusCode, 200);
  assert.equal((await app.inject('/api/config-ia/requests/no-existe')).statusCode, 404);
  r = await app.inject({ method: 'PUT', url: `/api/config-ia/requests/${sid}/draft`, payload: { autor: 'Ana', cambios: [{ op: 'crear', texto: 'Regla HTTP', criterios: [2], motivo: 'm' }] } });
  assert.equal(r.statusCode, 200);
  const codigo = j(r).borrador.cambios[0].codigo;

  r = await post('/api/config-ia/tests', { solicitudId: sid, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
  assert.equal(r.statusCode, 202);
  const tid = j(r).id;
  await drain(llm);
  r = await app.inject(`/api/config-ia/tests/${tid}`);
  assert.equal(r.statusCode, 200);
  assert.equal(j(r).estado, 'complete');
  assert.equal((await post(`/api/config-ia/tests/${tid}/verdict`, { revisor: 'Luis', veredicto: 'funciono' })).statusCode, 200);
  assert.equal(j(await app.inject(`/api/config-ia/requests/${sid}`)).publicacion.ok, true);
  r = await post(`/api/config-ia/requests/${sid}/publish`, { autor: 'Luis' });
  assert.equal(r.statusCode, 201);
  const { numero } = j(r);

  assert.equal(j(await app.inject('/api/config-ia/versions'))[0].numero, numero);
  assert.ok(j(await app.inject(`/api/config-ia/versions/${numero}`)).reglas.some((x) => x.codigo === codigo));
  assert.equal((await app.inject('/api/config-ia/versions/999')).statusCode, 404);
  assert.equal(j(await app.inject('/api/config-ia/rules?estado=activa&q=HTTP')).length, 1);
  assert.equal(j(await app.inject(`/api/config-ia/rules/${codigo}/history`))[0].accion, 'agregada');
  assert.equal((await post(`/api/config-ia/versions/${numero}/republish`, { autor: 'Luis', motivo: 'Probar' })).statusCode, 201);
  r = await post('/api/config-ia/requests', { ...body, criterioId: 3, filaOrden: undefined });
  assert.equal((await post(`/api/config-ia/requests/${j(r).id}/reject`, { autor: 'Ana', motivo: 'No aplica' })).statusCode, 200);
});
