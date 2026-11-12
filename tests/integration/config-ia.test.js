import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../src/platform/server.js';
import { pool, migrate, query, transaction } from '../../src/platform/db.js';
import { production, insertVersion, allocateRuleCode, listVersions, ruleHistory, republish, listRules } from '../../src/platform/config-ia/versions.js';
import { casesFor, createRequest, requestDetail, saveDraft, rejectRequest, listRequests } from '../../src/platform/config-ia/requests.js';
import { fakeLlm, seedAnalyzed } from './helpers.js';

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
  const { drain } = await import('./helpers.js');
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
