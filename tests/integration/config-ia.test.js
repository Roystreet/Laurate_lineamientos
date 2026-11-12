import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../src/platform/server.js';
import { pool, migrate, query, transaction } from '../../src/platform/db.js';
import { production, insertVersion, allocateRuleCode, listVersions, ruleHistory, republish, listRules } from '../../src/platform/config-ia/versions.js';
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
