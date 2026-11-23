import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildServer } from '../../src/platform/server.js';
import { pool, migrate, query, transaction, json } from '../../src/platform/db.js';
import { config } from '../../src/config/runtime.js';
import { production, insertVersion, allocateRuleCode, listVersions, ruleHistory, republish, listRules } from '../../src/platform/config-ia/versions.js';
import { casesFor, createRequest, requestDetail, saveDraft, rejectRequest, listRequests, publishRequest, loadRequest } from '../../src/platform/config-ia/requests.js';
import { createTest, testDetail, recordVerdict } from '../../src/platform/config-ia/playground.js';
import { startSuggestion, latestSuggestion, knownRules, approveSuggestion, discardSuggestion } from '../../src/platform/config-ia/suggestions.js';
import { INVALID_SUGGESTION } from '../../src/config-ia/suggestion.js';
import { claim, settle } from '../../src/platform/queue.js';
import { processTask } from '../../src/platform/processor.js';
import { fakeLlm, seedAnalyzed, seedPrepared, drain } from './helpers.js';

/** Fake suggestion model: answers `raw` (object → JSON text) and records each call. */
function fakeSuggest(raw, calls = []) {
  return async (args) => { calls.push(args); return { rawText: typeof raw === 'string' ? raw : JSON.stringify(raw), usage: { total_tokens: 1 } }; };
}
const plainRaw = { entendimiento: 'No exigir firma física.', regla: { cuando: 'el plan no tenga firma física', hacer: 'valida su vigencia por el pie de página', excepto: null, criterios: [2], motivo: 'El hallazgo exigía firma.' }, choques: [], recomendacion: 'regla_nueva', advertencias: [] };

let app;
// The server's own model is only used for suggestions; it must never reach OpenAI in tests.
before(async () => { await migrate(); await migrate(); app = await buildServer({ llm: fakeSuggest(plainRaw) }); });
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
  await assert.rejects(saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x' }] }), (e) => e.statusCode === 400);
  const original = { texto: 'Original', criterios: [3], activa: true };
  d = await saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x', antes: original }] });
  assert.equal(d.borrador.cambios[0].antes.texto, 'Original');
  assert.deepEqual(d.borrador.conflictos, []);
  await publishRules((await production()).reglas.map((r) => (r.codigo === code ? { ...r, texto: 'Cambiada por otro' } : r)), 'Otro');
  d = await requestDetail(missing.id);
  assert.equal(d.borrador.base.numero, (await production()).numero);
  assert.equal(d.borrador.conflictos[0].codigo, code);
  assert.equal(d.publicacion.motivo, 'Resuelve los conflictos del borrador.');
  // A stale screen keeps sending the old reference: still a conflict.
  d = await saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x', antes: original }] });
  assert.equal(d.borrador.conflictos[0].codigo, code);
  // Resolving explicitly against the current production text clears it.
  d = await saveDraft(missing.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo: code, texto: 'Editada', motivo: 'x', antes: { ...original, texto: 'Cambiada por otro' } }] });
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

test('playground: re-ejecutar una tarea borra el veredicto anterior', async () => {
  const llm = fakeLlm();
  const { reqId, runId } = await seedAnalyzed(app, '7.6.1', llm);
  const s = await requestWithRule(reqId, runId);
  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: runId, requerimientoId: reqId }] });
  await drain(llm);
  await recordVerdict(t.id, { revisor: 'Luis', veredicto: 'funciono' });
  assert.equal((await requestDetail(s.id)).publicacion.ok, true);
  await query("UPDATE tareas_procesamiento SET estado='queued' WHERE tipo='prueba' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.pruebaId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.lado'))='borrador'", [t.id]);
  await drain(llm);
  const d = await testDetail(t.id);
  assert.equal(d.veredicto, null);
  assert.equal(d.revisor, null);
  const r = await requestDetail(s.id);
  assert.equal(r.estado, 'en_prueba');
  assert.equal(r.publicacion.motivo, 'La prueba debe estar marcada como Funcionó.');
});

// ---- Regla sugerida por IA ----
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
// Fake suggestion model that answers only once `gate` resolves.
const held = (gate) => async () => { await gate.promise; return { rawText: JSON.stringify(plainRaw), usage: null }; };
const taskCount = async () => Number((await query('SELECT COUNT(*) n FROM tareas_procesamiento'))[0].n);
const suggestionRow = async (id) => (await query('SELECT * FROM ia_sugerencias WHERE id=?', [id]))[0];
const requestFor = ({ reqId, runId }, extra = {}) => createRequest({ autor: 'Luis', descripcion: 'Exige firma física', esperado: 'Validar por pie de página', ejecucionId: runId, requerimientoId: reqId, criterioId: 2, filaOrden: 0, ...extra });
const plainText = 'Cuando el plan no tenga firma física, valida su vigencia por el pie de página.';
async function publishedRule(texto, criterios = [2]) {
  const codigo = await transaction(async (c) => allocateRuleCode(c));
  await publishRules([...(await production()).reglas, { codigo, texto, criterios, activa: true }]);
  return codigo;
}
// Cites a production rule but claims it belongs to another request: the server must correct the origin.
const withClash = (codigo) => ({ ...plainRaw, recomendacion: codigo, choques: [{ codigo, origen: 'otra_solicitud', tipo: 'se_solapa', explicacion: 'También trata firmas.', ajuste: { texto: 'No exijas firma física; valida la vigencia por el pie de página.', criterios: [2], motivo: 'Incluye lo pedido.' } }] });

test('sugerencias: reglas conocidas de producción, de esta solicitud y de otras abiertas', async () => {
  const seeded = await seedAnalyzed(app, '7.7.1', fakeLlm());
  const keep = await publishedRule('Regla intacta', [3]);
  const touched = await publishedRule('Regla de producción', [4]);
  const s = await requestFor(seeded), other = await requestFor(seeded);
  const mine = await saveDraft(s.id, { autor: 'Ana', cambios: [
    { op: 'modificar', codigo: touched, texto: 'Regla editada aquí', motivo: 'm', antes: { texto: 'Regla de producción', criterios: [4], activa: true } },
    { op: 'crear', texto: 'Regla nueva aquí', criterios: [2], motivo: 'm' },
  ] });
  const theirs = await saveDraft(other.id, { autor: 'Ana', cambios: [
    { op: 'crear', texto: 'Regla de otra solicitud', criterios: [5], motivo: 'm' },
    { op: 'modificar', codigo: keep, texto: 'Intacta editada en otra', motivo: 'm', antes: { texto: 'Regla intacta', criterios: [3], activa: true } },
    { op: 'modificar', codigo: touched, activa: false, motivo: 'm', antes: { texto: 'Regla de producción', criterios: [4], activa: true } },
  ] });
  const known = await knownRules(await loadRequest(s.id));
  const find = (codigo, origen) => known.filter((k) => k.codigo === codigo && k.origen === origen);
  assert.deepEqual(find(keep, 'produccion'), [{ codigo: keep, texto: 'Regla intacta', criterios: [3], activa: true, origen: 'produccion', solicitud_numero: null }]);
  assert.deepEqual(find(touched, 'produccion'), []);
  assert.equal(find(touched, 'esta_solicitud')[0].texto, 'Regla editada aquí');
  assert.equal(find(mine.borrador.cambios[1].codigo, 'esta_solicitud')[0].texto, 'Regla nueva aquí');
  const otherNew = theirs.borrador.cambios[0].codigo;
  assert.deepEqual(find(otherNew, 'otra_solicitud'), [{ codigo: otherNew, texto: 'Regla de otra solicitud', criterios: [5], activa: true, origen: 'otra_solicitud', solicitud_numero: other.numero }]);
  // A change without criteria takes them from the base rule; a change without text (only on/off) is not listed.
  assert.deepEqual(find(keep, 'otra_solicitud').map((k) => [k.texto, k.criterios, k.solicitud_numero]), [['Intacta editada en otra', [3], other.numero]]);
  assert.deepEqual(find(touched, 'otra_solicitud').filter((k) => k.solicitud_numero === other.numero), []);
  assert.ok(!known.some((k) => k.origen === 'otra_solicitud' && k.solicitud_numero === s.numero));
});

test('sugerencias: generar, consultar y trazabilidad', async () => {
  const seeded = await seedAnalyzed(app, '7.7.2', fakeLlm());
  // The requirement type comes from the run snapshot (not the default 'lineamiento').
  await query("UPDATE ejecuciones SET snapshot=JSON_SET(snapshot,'$.requirements[0].ficha.tipo','plan') WHERE id=?", [seeded.runId]);
  const codigo = await publishedRule('No exigir firmas');
  const s = await requestFor(seeded);
  const tasks = await taskCount();
  const calls = [];
  const { id, done } = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest(withClash(codigo), calls));
  await done;
  const v = await latestSuggestion(s.id);
  assert.equal(v.id, id);
  assert.equal(v.estado, 'lista');
  assert.equal(v.desactualizada, false);
  assert.equal(v.error, null);
  assert.equal(v.autor, 'Ana');
  assert.equal(v.indicacion, null);
  assert.ok(v.created_at);
  assert.equal(v.propuesta.regla.texto, plainText);
  assert.equal(v.propuesta.choques[0].origen, 'produccion');
  assert.equal(v.propuesta.choques[0].ajuste.texto, 'No exijas firma física; valida la vigencia por el pie de página.');
  assert.equal(v.propuesta.recomendacion, codigo);
  assert.deepEqual(v.aprobaciones, []);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, config.suggestionModel);
  assert.equal(calls[0].reasoningEffort, config.suggestionEffort);
  assert.equal(calls[0].timeoutMs, 120000);
  assert.equal(calls[0].maxAttempts, 2);
  assert.ok(calls[0].user.includes('<que_esta_mal>Exige firma física</que_esta_mal>'));
  assert.ok(calls[0].user.includes('<requerimiento codigo="7.7.2" tipo="plan"/>'));
  assert.ok(calls[0].user.includes(`- [${codigo}] (produccion, activa) criterios 2: No exigir firmas`));

  const row = await suggestionRow(id);
  assert.deepEqual(json(row.mensajes), { system: calls[0].system, user: calls[0].user });
  assert.equal(row.respuesta, JSON.stringify(withClash(codigo)));
  assert.deepEqual(json(row.uso), { total_tokens: 1 });
  assert.equal(row.modelo, config.suggestionModel);
  assert.equal(row.esfuerzo, config.suggestionEffort);
  assert.ok(Number(row.duracion_ms) >= 0 && row.finished_at);
  assert.equal(row.base_version_id, (await production()).id);
  const d = await requestDetail(s.id);
  assert.equal(d.sugerencia.id, id);
  assert.ok(d.eventos.some((e) => e.tipo === 'sugerencia_creada' && e.autor === 'Ana' && e.detalle.sugerencia === id));
  assert.equal(d.estado, 'pendiente');
  assert.equal(await taskCount(), tasks);

  await publishedRule('Publicada después');
  assert.equal((await latestSuggestion(s.id)).desactualizada, true);
});

test('sugerencias: JSON envuelto en markdown queda lista', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.7.3', fakeLlm()));
  const { done } = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest('```json\n' + JSON.stringify(plainRaw) + '\n```'));
  await done;
  const v = await latestSuggestion(s.id);
  assert.equal(v.estado, 'lista');
  assert.equal(v.propuesta.regla.texto, plainText);
});

test('sugerencias: respuesta inválida o IA caída → error, la solicitud existe', async (t) => {
  const s = await requestFor(await seedAnalyzed(app, '7.7.4', fakeLlm()));
  const logged = t.mock.method(console, 'error', () => {});
  let { id, done } = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest('no es json'));
  await done;
  let v = await latestSuggestion(s.id);
  assert.equal(v.id, id);
  assert.equal(v.estado, 'error');
  assert.equal(v.error, INVALID_SUGGESTION);
  assert.equal(v.propuesta, null);
  assert.equal((await suggestionRow(id)).respuesta, 'no es json');
  // An unexpected failure (here, broken JSON) is logged; a well-formed but invalid suggestion is not.
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.join(' '), new RegExp(`^Sugerencia ${id}: .*no se pudo parsear JSON`));

  ({ id, done } = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest({ entendimiento: 'x', regla: { cuando: 'algo', criterios: [2] } })));
  await done;
  v = await latestSuggestion(s.id);
  assert.equal(v.estado, 'error');
  assert.equal(v.error, INVALID_SUGGESTION);
  assert.equal(logged.mock.callCount(), 1);

  // The model fails: generic message stored, detail logged without the API key.
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-prueba-secreta';
  try {
    ({ id, done } = await startSuggestion(s.id, { autor: 'Ana' }, async () => { throw new Error('401 clave sk-prueba-secreta rechazada'); }));
    await done;
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
  v = await latestSuggestion(s.id);
  assert.equal(v.id, id);
  assert.equal(v.estado, 'error');
  assert.equal(v.error, 'No fue posible generar la sugerencia. Pide otra o escribe la regla a mano.');
  const row = await suggestionRow(id);
  assert.equal(row.respuesta, null);
  assert.ok(!JSON.stringify(row).includes('sk-prueba-secreta'));
  assert.equal(logged.mock.callCount(), 2);
  assert.ok(!logged.mock.calls[1].arguments.join(' ').includes('sk-prueba-secreta'));
  assert.equal((await requestDetail(s.id)).estado, 'pendiente');
});

test('sugerencias: pedir otra reemplaza, no hay dos a la vez y una respuesta tardía no revive', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.7.5', fakeLlm()));
  const gateA = deferred();
  const A = await startSuggestion(s.id, { autor: 'Ana' }, held(gateA));
  try {
    assert.equal((await latestSuggestion(s.id)).estado, 'generando');
    await assert.rejects(startSuggestion(s.id, { autor: 'Luis' }, fakeSuggest(plainRaw)), (e) => e.statusCode === 409 && e.message === 'Ya se está generando una sugerencia.');
  } finally { gateA.resolve(); await A.done; }
  assert.equal((await latestSuggestion(s.id)).estado, 'lista');

  const calls = [];
  const B = await startSuggestion(s.id, { autor: 'Luis', indicacion: '  más específica ' }, fakeSuggest(plainRaw, calls));
  await B.done;
  assert.equal((await suggestionRow(A.id)).estado, 'reemplazada');
  const v = await latestSuggestion(s.id);
  assert.equal(v.id, B.id);
  assert.equal(v.estado, 'lista');
  assert.equal(v.autor, 'Luis');
  assert.equal(v.indicacion, 'más específica');
  assert.ok(calls[0].user.includes(`<sugerencia_anterior>\n${plainText}\n</sugerencia_anterior>`));
  assert.ok(calls[0].user.includes('<indicacion_del_usuario>más específica</indicacion_del_usuario>'));

  // A late answer for a suggestion that was replaced meanwhile does not bring it back.
  const gateC = deferred();
  const C = await startSuggestion(s.id, { autor: 'Ana' }, held(gateC));
  try {
    assert.equal((await suggestionRow(B.id)).estado, 'reemplazada');
    await query("UPDATE ia_sugerencias SET estado='reemplazada' WHERE id=?", [C.id]);
  } finally { gateC.resolve(); await C.done; }
  const late = await suggestionRow(C.id);
  assert.equal(late.estado, 'reemplazada');
  assert.equal(late.propuesta, null);
  assert.equal(await latestSuggestion(s.id), null);
});

test('sugerencias: generando vieja se muestra como interrumpida', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.7.6', fakeLlm()));
  const A = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest(plainRaw));
  await A.done;
  // As if the API restarted mid-generation: the row stays 'generando' and nobody finishes it.
  await query("UPDATE ia_sugerencias SET estado='generando', created_at=NOW(3) - INTERVAL 299 SECOND WHERE id=?", [A.id]);
  assert.equal((await latestSuggestion(s.id)).estado, 'generando');
  await assert.rejects(startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest(plainRaw)), (e) => e.statusCode === 409);
  await query('UPDATE ia_sugerencias SET created_at=NOW(3) - INTERVAL 301 SECOND WHERE id=?', [A.id]);
  const v = await latestSuggestion(s.id);
  assert.equal(v.estado, 'error');
  assert.equal(v.error, 'Se interrumpió la sugerencia; pide otra.');
  const B = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest(plainRaw));
  await B.done;
  assert.equal((await latestSuggestion(s.id)).id, B.id);
  assert.equal((await suggestionRow(A.id)).estado, 'reemplazada');
});

test('sugerencias: solicitud cerrada o indicación larga', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.7.7', fakeLlm()));
  const llm = fakeSuggest(plainRaw);
  await assert.rejects(startSuggestion(s.id, { autor: 'Ana', indicacion: 'x'.repeat(501) }, llm), (e) => e.statusCode === 400 && e.message === 'La indicación admite hasta 500 caracteres.');
  await assert.rejects(startSuggestion(s.id, { autor: ' ' }, llm), (e) => e.statusCode === 400);
  await assert.rejects(startSuggestion('no-existe', { autor: 'Ana' }, llm), (e) => e.statusCode === 404);
  await assert.rejects(latestSuggestion('no-existe'), (e) => e.statusCode === 404);
  const ok = await startSuggestion(s.id, { autor: 'Ana', indicacion: 'x'.repeat(500) }, llm);
  await ok.done;
  assert.equal((await latestSuggestion(s.id)).indicacion.length, 500);
  await rejectRequest(s.id, { autor: 'Ana', motivo: 'No aplica' });
  await assert.rejects(startSuggestion(s.id, { autor: 'Ana' }, llm), (e) => e.statusCode === 409 && e.message === 'La solicitud ya está cerrada.');
});

test('API: crear solicitud arranca la sugerencia', async (t) => {
  const { reqId, runId } = await seedAnalyzed(app, '7.7.8', fakeLlm());
  const body = { autor: 'Luis', descripcion: 'Exige firma física', ejecucionId: runId, requerimientoId: reqId, criterioId: 2, filaOrden: 0 };
  const post = (server, url, payload) => server.inject({ method: 'POST', url, payload });
  const settled = async (server, id) => {
    for (let i = 0; i < 100; i++) {
      const { sugerencia } = (await server.inject(`/api/config-ia/requests/${id}/suggestion`)).json();
      if (sugerencia?.estado !== 'generando') return sugerencia;
      await sleep(20);
    }
    throw new Error('La sugerencia no terminó.');
  };

  const app2 = await buildServer({ llm: fakeSuggest(plainRaw) });
  try {
    let r = await post(app2, '/api/config-ia/requests', body);
    assert.equal(r.statusCode, 201);
    const { id, numero, sugerenciaId } = r.json();
    assert.ok(Number.isInteger(numero));
    assert.match(sugerenciaId, /^[0-9a-f-]{36}$/);
    let sug = await settled(app2, id);
    assert.equal(sug.id, sugerenciaId);
    assert.equal(sug.estado, 'lista');
    assert.equal(sug.autor, 'Luis');
    assert.equal(sug.propuesta.regla.texto, plainText);
    assert.equal((await app2.inject(`/api/config-ia/requests/${id}`)).json().sugerencia.id, sugerenciaId);

    r = await post(app2, `/api/config-ia/requests/${id}/suggestions`, { autor: 'Ana', indicacion: 'más específica' });
    assert.equal(r.statusCode, 202);
    sug = await settled(app2, id);
    assert.equal(sug.id, r.json().id);
    assert.equal(sug.indicacion, 'más específica');
    r = await post(app2, `/api/config-ia/requests/${id}/suggestions`, { autor: 'Ana', indicacion: 'x'.repeat(501) });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'La indicación admite hasta 500 caracteres.');
    assert.equal((await app2.inject('/api/config-ia/requests/no-existe/suggestion')).statusCode, 404);
  } finally { await app2.close(); }

  // The model is down: creating the request still answers 201 and the suggestion ends in error.
  const logged = t.mock.method(console, 'error', () => {});
  const app3 = await buildServer({ llm: async () => { throw new Error('caída'); } });
  try {
    const r = await post(app3, '/api/config-ia/requests', body);
    assert.equal(r.statusCode, 201);
    const sug = await settled(app3, r.json().id);
    assert.equal(sug.id, r.json().sugerenciaId);
    assert.equal(sug.estado, 'error');
    assert.equal(logged.mock.callCount(), 1);
  } finally { await app3.close(); }
});

test('sugerencias: una regla que producción ya no tiene toma los criterios de su versión de referencia', async () => {
  const seeded = await seedAnalyzed(app, '7.8.9', fakeLlm());
  const codigo = await publishedRule('Regla que se retira', [6]);
  const s = await requestFor(seeded), other = await requestFor(seeded);
  await saveDraft(other.id, { autor: 'Ana', cambios: [{ op: 'modificar', codigo, texto: 'Editada en otra solicitud', motivo: 'm', antes: { texto: 'Regla que se retira', criterios: [6], activa: true } }] });
  // Production drops the rule (as a reversion to an older version does).
  await publishRules((await production()).reglas.filter((r) => r.codigo !== codigo));
  const known = await knownRules(await loadRequest(s.id));
  assert.deepEqual(known.filter((k) => k.codigo === codigo).map((k) => [k.origen, k.texto, k.criterios]), [['otra_solicitud', 'Editada en otra solicitud', [6]]]);
});

test('sugerencias: dos solicitudes nuevas piden sugerencia a la vez sin bloquearse', async () => {
  const a = await requestFor(await seedAnalyzed(app, '7.8.7', fakeLlm()));
  const b = await requestFor(await seedAnalyzed(app, '7.8.8', fakeLlm()));
  const gate = deferred();
  const started = await Promise.allSettled([a, b].map((s) => startSuggestion(s.id, { autor: 'Ana' }, held(gate))));
  try {
    assert.deepEqual(started.map((r) => r.reason?.message ?? r.status), ['fulfilled', 'fulfilled']);
    for (const { value } of started) assert.equal((await suggestionRow(value.id)).estado, 'generando');
  } finally {
    gate.resolve();
    await Promise.all(started.filter((r) => r.status === 'fulfilled').map((r) => r.value.done));
  }
});

// ---- Aprobar y descartar sugerencias ----
const postApi = (url, payload) => app.inject({ method: 'POST', url, payload });
/** Generates a suggestion for request `s` with a fake model answering `raw` and waits until it is saved. */
async function suggest(s, raw = plainRaw) {
  const { id, done } = await startSuggestion(s.id, { autor: 'Ana' }, fakeSuggest(raw));
  await done;
  return id;
}
const plainMotivo = plainRaw.regla.motivo;

test('aprobar: regla nueva y ajuste de producción entran al borrador con sugerencia_id', async () => {
  const llm = fakeLlm();
  const seeded = await seedAnalyzed(app, '7.8.1', llm);
  const codigo = await publishedRule('No exigir firmas');
  const s = await requestFor(seeded);
  const id = await suggest(s, withClash(codigo));

  let d = await approveSuggestion(id, { autor: 'Marta', opcion: 'regla_nueva' });
  assert.equal(d.estado, 'en_prueba');
  const nueva = d.borrador.cambios[0].codigo;
  assert.match(nueva, /^R-\d+$/);
  assert.deepEqual(d.borrador.cambios, [{ op: 'crear', codigo: nueva, texto: plainText, criterios: [2], autor: 'Marta', motivo: plainMotivo, sugerencia_id: id }]);
  assert.equal(d.sugerencia.estado, 'aprobada');
  const { fecha, ...aprobacion } = d.sugerencia.aprobaciones[0];
  assert.ok(!Number.isNaN(Date.parse(fecha)));
  assert.deepEqual(aprobacion, { opcion: 'regla_nueva', codigo: nueva, editada: false, texto: plainText, criterios: [2], motivo: plainMotivo, autor: 'Marta' });
  assert.deepEqual(d.eventos.filter((e) => e.tipo === 'sugerencia_aprobada').map((e) => [e.autor, e.detalle]), [['Marta', { sugerencia: id, opcion: 'regla_nueva', editada: false }]]);

  // The adjustment of the production rule, edited, through the API.
  const r = await postApi(`/api/config-ia/suggestions/${id}/approve`, { autor: 'Marta', opcion: codigo, texto: '  Texto editado del ajuste ' });
  assert.equal(r.statusCode, 200);
  d = r.json();
  assert.equal(d.borrador.cambios.length, 2);
  assert.deepEqual(d.borrador.cambios[1], {
    op: 'modificar', codigo, texto: 'Texto editado del ajuste', criterios: [2], autor: 'Marta', motivo: 'Incluye lo pedido.', sugerencia_id: id,
    antes: { texto: 'No exigir firmas', criterios: [2], activa: true },
  });
  assert.deepEqual(d.borrador.conflictos, []);
  assert.equal(d.borrador.reglas.find((x) => x.codigo === codigo).texto, 'Texto editado del ajuste');
  assert.deepEqual(d.sugerencia.aprobaciones.map((a) => [a.opcion, a.codigo, a.editada, a.texto]), [['regla_nueva', nueva, false, plainText], [codigo, codigo, true, 'Texto editado del ajuste']]);
  assert.equal(d.eventos.filter((e) => e.tipo === 'sugerencia_aprobada').at(-1).detalle.editada, true);

  // The Playground tests the approved draft as it does today.
  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: seeded.runId, requerimientoId: seeded.reqId }] });
  await drain(llm);
  const tested = await testDetail(t.id);
  assert.equal(tested.estado, 'complete');
  assert.equal(tested.exploratoria, false);
  assert.deepEqual(tested.criterios, [2]);
});

test('aprobar: ajuste de una regla de esta solicitud la reemplaza en el borrador', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.8.2', fakeLlm()));
  const first = await suggest(s);
  const nueva = (await approveSuggestion(first, { autor: 'Ana', opcion: 'regla_nueva' })).borrador.cambios[0].codigo;
  // After "No funcionó", the next suggestion proposes replacing the rule this request already has.
  const ajuste = { texto: 'Cuando el plan no tenga firma física, valida vigencia y versión por el pie de página.', criterios: [2, 3], motivo: 'La anterior no bastó.' };
  const second = await suggest(s, { ...plainRaw, recomendacion: nueva, choques: [{ codigo: nueva, origen: 'esta_solicitud', tipo: 'duplica', explicacion: 'Es la regla aprobada antes.', ajuste }] });
  assert.equal((await latestSuggestion(s.id)).propuesta.choques[0].origen, 'esta_solicitud');
  const d = await approveSuggestion(second, { autor: 'Luis', opcion: nueva, texto: ` ${ajuste.texto} `, criterios: [3, 2] });
  assert.deepEqual(d.borrador.cambios, [{ op: 'crear', codigo: nueva, ...ajuste, autor: 'Luis', sugerencia_id: second }]);
  // The same content with other spacing or order is not an edit.
  assert.deepEqual(d.sugerencia.aprobaciones.map((a) => [a.opcion, a.codigo, a.editada]), [[nueva, nueva, false]]);
  assert.equal((await suggestionRow(first)).estado, 'reemplazada');
});

test('aprobar: misma opción dos veces → 409 y un solo cambio', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.8.3', fakeLlm()));
  const id = await suggest(s);
  // Two clicks at once: the request lock serializes them and the second finds the option approved.
  const both = await Promise.allSettled([1, 2].map(() => approveSuggestion(id, { autor: 'Ana', opcion: 'regla_nueva' })));
  assert.equal(both.filter((r) => r.status === 'fulfilled').length, 1);
  const { reason } = both.find((r) => r.status === 'rejected');
  assert.deepEqual([reason.statusCode, reason.message], [409, 'Esta opción ya se aprobó.']);
  await assert.rejects(approveSuggestion(id, { autor: 'Ana', opcion: 'regla_nueva' }), (e) => e.statusCode === 409 && e.message === 'Esta opción ya se aprobó.');
  const d = await requestDetail(s.id);
  assert.equal(d.borrador.cambios.length, 1);
  assert.equal(d.sugerencia.aprobaciones.length, 1);
  assert.equal(d.eventos.filter((e) => e.tipo === 'sugerencia_aprobada').length, 1);
});

test('aprobar: producción cambió → 409 y borrador intacto', async () => {
  const s = await requestFor(await seedAnalyzed(app, '7.8.4', fakeLlm()));
  const id = await suggest(s);
  const before = (await saveDraft(s.id, { autor: 'Ana', cambios: [{ op: 'crear', texto: 'Regla escrita a mano', criterios: [2], motivo: 'm' }] })).borrador.cambios;
  await publishRules((await production()).reglas);
  await assert.rejects(approveSuggestion(id, { autor: 'Ana', opcion: 'regla_nueva' }), (e) => e.statusCode === 409 && e.message === 'Producción cambió; pide otra sugerencia.');
  const d = await requestDetail(s.id);
  assert.deepEqual(d.borrador.cambios, before);
  assert.equal(d.sugerencia.estado, 'lista');
  assert.deepEqual(d.sugerencia.aprobaciones, []);
  assert.equal((await latestSuggestion(s.id)).desactualizada, true);
});

test('aprobar/descartar: estados no válidos', async () => {
  const seeded = await seedAnalyzed(app, '7.8.5', fakeLlm());
  const s = await requestFor(seeded);
  const approve = (id, body = {}) => approveSuggestion(id, { autor: 'Ana', opcion: 'regla_nueva', ...body });
  const discard = (id) => discardSuggestion(id, { autor: 'Ana' });
  const conflict = (message) => (e) => e.statusCode === 409 && e.message === message;
  let id = await suggest(s);
  await assert.rejects(approve(id, { opcion: 'R-999999' }), (e) => e.statusCode === 400 && e.message === 'Opción no reconocida.');
  await assert.rejects(approve(id, { autor: ' ' }), (e) => e.statusCode === 400);
  await assert.rejects(approve(id, { texto: ' ' }), (e) => e.statusCode === 400 && e.message === 'El texto de la regla debe tener entre 1 y 2000 caracteres.');
  for (const action of ['approve', 'discard']) {
    const r = await postApi(`/api/config-ia/suggestions/no-existe/${action}`, { autor: 'Ana', opcion: 'regla_nueva' });
    assert.deepEqual([r.statusCode, r.json().error], [404, 'Sugerencia no encontrada.']);
  }

  // A ready suggestion is discarded through the API; it can no longer be approved.
  const r = await postApi(`/api/config-ia/suggestions/${id}/discard`, { autor: 'Luis' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().sugerencia.estado, 'descartada');
  assert.deepEqual(r.json().eventos.filter((e) => e.tipo === 'sugerencia_descartada').map((e) => [e.autor, e.detalle]), [['Luis', { sugerencia: id }]]);
  await assert.rejects(approve(id), conflict('Esta sugerencia ya no se puede aprobar.'));
  await assert.rejects(discard(id), conflict('Esta sugerencia ya no se puede descartar.'));
  assert.deepEqual((await requestDetail(s.id)).borrador.cambios, []);

  // An approved suggestion can no longer be discarded.
  id = await suggest(s);
  await approve(id);
  await assert.rejects(discard(id), conflict('Esta sugerencia ya no se puede descartar.'));

  // One still generating cannot be approved but can be discarded; its late answer does not bring it back.
  const gate = deferred();
  const pending = await startSuggestion(s.id, { autor: 'Ana' }, held(gate));
  try {
    await assert.rejects(approve(pending.id), conflict('Esta sugerencia ya no se puede aprobar.'));
    assert.equal((await discard(pending.id)).sugerencia.estado, 'descartada');
  } finally { gate.resolve(); await pending.done; }
  assert.equal((await suggestionRow(pending.id)).estado, 'descartada');

  // One that failed cannot be approved but can be discarded.
  id = await suggest(s, { entendimiento: 'x', regla: { cuando: 'algo', criterios: [2] } });
  await assert.rejects(approve(id), conflict('Esta sugerencia ya no se puede aprobar.'));
  assert.equal((await discard(id)).sugerencia.estado, 'descartada');

  // A closed request accepts neither.
  const closed = await requestFor(seeded);
  id = await suggest(closed);
  await rejectRequest(closed.id, { autor: 'Ana', motivo: 'No aplica' });
  await assert.rejects(approve(id), conflict('La solicitud ya está cerrada.'));
  await assert.rejects(discard(id), conflict('La solicitud ya está cerrada.'));
  assert.equal((await suggestionRow(id)).estado, 'lista');
});

test('publicar: el historial de la regla guarda la sugerencia de origen', async () => {
  const llm = fakeLlm();
  const seeded = await seedAnalyzed(app, '7.8.6', llm);
  const s = await requestFor(seeded);
  const id = await suggest(s);
  let d = await approveSuggestion(id, { autor: 'Marta', opcion: 'regla_nueva' });
  const nueva = d.borrador.cambios[0].codigo;
  // Saving the draft from the editor keeps where the approved rule came from.
  d = await saveDraft(s.id, { autor: 'Ana', cambios: [...d.borrador.cambios, { op: 'crear', texto: 'Regla escrita a mano', criterios: [2], motivo: 'm' }] });
  assert.equal(d.borrador.cambios[0].sugerencia_id, id);
  const manual = d.borrador.cambios[1].codigo;
  const t = await createTest({ solicitudId: s.id, autor: 'Ana', casos: [{ ejecucionId: seeded.runId, requerimientoId: seeded.reqId }] });
  await drain(llm);
  await recordVerdict(t.id, { revisor: 'Luis', veredicto: 'funciono' });
  await publishRequest(s.id, { autor: 'Luis' });

  const [h] = await ruleHistory(nueva);
  assert.deepEqual([h.accion, h.autor, h.sugerencia_id], ['agregada', 'Marta', id]);
  assert.equal((await ruleHistory(manual))[0].sugerencia_id, null);
  assert.equal((await app.inject(`/api/config-ia/rules/${nueva}/history`)).json()[0].sugerencia_id, id);
});
