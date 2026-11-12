import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, RULES_HEADER } from '../src/config-ia/prompt.js';
import { evaluarCriterio } from '../src/steps/2-procesar-requerimiento/index.js';
import { planCriterios } from '../src/prompt/criterios/index.js';

const R = (n, criterios, activa = true, texto = `Regla ${n}`) => ({ codigo: `R-${n}`, texto, criterios, activa });

test('sin reglas aplicables el prompt queda idéntico', () => {
  assert.equal(applyRules('BASE', [], 2), 'BASE');
  assert.equal(applyRules('BASE', [R(1, [3]), R(2, [2], false)], 2), 'BASE');
});

test('agrega solo reglas activas del criterio, ordenadas por número, al final', () => {
  const out = applyRules('BASE', [R(10, [2]), R(2, [1, 2]), R(3, [4])], 2);
  assert.equal(out, `BASE\n\n${RULES_HEADER}\n- [R-2] Regla 2\n- [R-10] Regla 10`);
});

test('saltos de línea internos se aplanan; comillas y [R- se conservan', () => {
  const out = applyRules('B', [R(1, [1], true, 'Usa "comillas"\ny [R-9] literal')], 1);
  assert.ok(out.endsWith('- [R-1] Usa "comillas" y [R-9] literal'));
});

test('encabezado exacto', () => {
  assert.equal(RULES_HEADER, 'REGLAS ADICIONALES (OBLIGATORIAS) — Aplica estas reglas al evaluar. No modifican el FORMATO DE SALIDA ESTRICTO definido arriba.');
});

test('evaluarCriterio envía el system con reglas', async () => {
  const criterio = planCriterios('lineamiento').find((c) => c.id === 2);
  let sent;
  const llm = async (a) => { sent = a.system; return { rawText: '[{"estado":"Cumple"}]' }; };
  const ctx = { n_req: '1', requerimiento: 'r', tipo_requerimiento: 'lineamiento', lineamientos_evaluados: 'a' };
  await evaluarCriterio(criterio, {
    dryRun: false, ctx, llm, rules: [R(1, [2])],
    buildArgs: { n_req: '1', requerimiento: 'r', tipo: 'lineamiento', consideraciones: [], lineamientos: 'x', lineamientoIds: ['a'] },
  });
  assert.ok(sent.endsWith('- [R-1] Regla 1'));
});
