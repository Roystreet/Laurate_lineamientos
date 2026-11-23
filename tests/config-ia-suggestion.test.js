import test from 'node:test';
import assert from 'node:assert/strict';
import { composeRuleText, validateSuggestion, optionOf, applyApproval, INVALID_SUGGESTION } from '../src/config-ia/suggestion.js';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const K = (codigo, origen, extra = {}) => ({ codigo, texto: `Regla ${codigo}`, criterios: [2], activa: true, origen, solicitud_numero: null, ...extra });
const known = [K('R-3', 'produccion'), K('R-20', 'esta_solicitud'), K('R-5', 'otra_solicitud', { solicitud_numero: 14 })];
const regla = (extra = {}) => ({ cuando: 'el plan no tenga firma', hacer: 'valida la vigencia', criterios: [2], ...extra });
const raw = (extra = {}) => ({ entendimiento: 'e', regla: regla(), ...extra });

test('composeRuleText arma una sola línea con la estructura fija', () => {
  assert.equal(composeRuleText({ cuando: 'el plan no tenga firma física', hacer: 'valida su vigencia por el código y la versión del pie de página', excepto: null }),
    'Cuando el plan no tenga firma física, valida su vigencia por el código y la versión del pie de página.');
  assert.equal(composeRuleText({ cuando: 'Cuando el plan\nno tenga firma.', hacer: 'no lo marques "No cumple".', excepto: 'el documento exija firma.' }),
    'Cuando el plan no tenga firma, no lo marques "No cumple". Excepción: el documento exija firma.');
  assert.throws(() => composeRuleText({ cuando: ' ', hacer: 'x' }), { message: INVALID_SUGGESTION });
});

test('validateSuggestion: forma mínima, criterios y advertencia criterio_distinto', () => {
  const p = validateSuggestion(raw({ regla: regla({ criterios: [1] }) }), { known: [], criterioId: 2 });
  assert.equal(p.regla.texto, 'Cuando el plan no tenga firma, valida la vigencia.');
  assert.equal(p.regla.motivo, 'Sugerida por IA');
  assert.equal(p.regla.excepto, null);
  assert.equal(p.recomendacion, 'regla_nueva');
  const w = p.advertencias.find((a) => a.tipo === 'criterio_distinto');
  assert.ok(w && w.explicacion.includes('Coherencia'));
  const ok = validateSuggestion(raw(), { known: [], criterioId: 2 });
  assert.ok(!ok.advertencias.some((a) => a.tipo === 'criterio_distinto'));
  for (const r of [raw({ regla: regla({ hacer: '' }) }), raw({ regla: regla({ criterios: [] }) }), raw({ regla: regla({ criterios: [7] }) }), raw({ regla: regla({ hacer: 'x'.repeat(2001) }) }), {}, null]) {
    assert.throws(() => validateSuggestion(r, { known: [], criterioId: 2 }), { message: INVALID_SUGGESTION });
  }
});

test('validateSuggestion: choques con origen corregido, inventados descartados y ajuste solo propio o de producción', () => {
  const aj = { texto: 'a\nb', criterios: [2], motivo: 'm' };
  const p = validateSuggestion(raw({ choques: [
    { codigo: 'R-3', origen: 'otra_solicitud', tipo: 'contradice', explicacion: 'x', ajuste: aj },
    { codigo: 'R-99', origen: 'produccion', tipo: 'duplica', explicacion: 'x' },
    { codigo: 'R-5', origen: 'otra_solicitud', tipo: 'duplica', explicacion: 'x', ajuste: aj },
    { codigo: 'R-20', origen: 'esta_solicitud', tipo: 'inventado', explicacion: 'x', ajuste: aj },
  ] }), { known, criterioId: 2 });
  assert.deepEqual(p.choques.map((c) => [c.codigo, c.origen, c.solicitud_numero]), [['R-3', 'produccion', null], ['R-5', 'otra_solicitud', 14], ['R-20', 'esta_solicitud', null]]);
  assert.equal(p.choques[1].ajuste, null);
  assert.equal(p.choques[2].ajuste.texto, 'a b');
  assert.equal(p.choques[2].tipo, 'se_solapa');
});

test('validateSuggestion: choques repetidos se unen y cada otra solicitud conserva su número', () => {
  const k = [K('R-3', 'produccion'), K('R-5', 'otra_solicitud', { solicitud_numero: 14 }), K('R-5', 'otra_solicitud', { solicitud_numero: 15 })];
  const c = (extra) => ({ tipo: 'duplica', explicacion: 'x', ...extra });
  const p = validateSuggestion(raw({ choques: [
    c({ codigo: 'R-3', origen: 'produccion' }), c({ codigo: 'R-3', origen: 'produccion' }),
    c({ codigo: 'R-5', origen: 'otra_solicitud', solicitud_numero: 15 }), c({ codigo: 'R-5', origen: 'otra_solicitud', solicitud_numero: 14 }),
    c({ codigo: 'R-5', origen: 'otra_solicitud', solicitud_numero: 15 }),
  ] }), { known: k, criterioId: 2 });
  assert.deepEqual(p.choques.map((x) => [x.codigo, x.origen, x.solicitud_numero]), [['R-3', 'produccion', null], ['R-5', 'otra_solicitud', 15], ['R-5', 'otra_solicitud', 14]]);
});

test('validateSuggestion: criterios como texto numérico se aceptan', () => {
  const p = validateSuggestion(raw({ regla: regla({ criterios: ['2'] }), choques: [{ codigo: 'R-3', tipo: 'contradice', explicacion: 'x', ajuste: { texto: 'T', criterios: ['3', 2], motivo: 'm' } }] }), { known, criterioId: 2 });
  assert.deepEqual(p.regla.criterios, [2]);
  assert.deepEqual(p.choques[0].ajuste.criterios, [2, 3]);
  assert.ok(!p.advertencias.some((a) => a.tipo === 'criterio_distinto'));
});

test('validateSuggestion: recomendación y advertencias', () => {
  const ajuste = { texto: 'T', criterios: [2], motivo: 'm' };
  const choques = [{ codigo: 'R-3', tipo: 'contradice', explicacion: 'x', ajuste }, { codigo: 'R-5', tipo: 'duplica', explicacion: 'x' }];
  const ctx = { known, criterioId: 2 };
  assert.equal(validateSuggestion(raw({ choques, recomendacion: 'R-3' }), ctx).recomendacion, 'R-3');
  assert.equal(validateSuggestion(raw({ choques, recomendacion: 'R-5' }), ctx).recomendacion, 'regla_nueva');
  assert.equal(validateSuggestion(raw({ choques }), ctx).recomendacion, 'regla_nueva');
  const p = validateSuggestion(raw({ advertencias: ['texto suelto', { tipo: 'raro', explicacion: 'x' }, { tipo: 'problema_de_entrada', explicacion: '' }] }), ctx);
  assert.deepEqual(p.advertencias, [{ tipo: 'otra', explicacion: 'texto suelto' }, { tipo: 'otra', explicacion: 'x' }]);
});

test('optionOf devuelve la regla nueva o el ajuste de un choque', () => {
  const p = validateSuggestion(raw({ choques: [{ codigo: 'R-3', tipo: 'contradice', explicacion: 'x', ajuste: { texto: 'T', criterios: [2], motivo: 'm' } }] }), { known, criterioId: 2 });
  assert.deepEqual(optionOf(p, 'regla_nueva'), { texto: p.regla.texto, criterios: [2], motivo: 'Sugerida por IA' });
  assert.deepEqual(optionOf(p, 'R-3'), { texto: 'T', criterios: [2], motivo: 'm' });
  assert.throws(() => optionOf(p, 'R-9'), { statusCode: 400, message: 'Opción no reconocida.' });
});

test('optionOf: el mismo código en otra solicitud y en producción toma el ajuste de producción', () => {
  const k = [K('R-3', 'produccion'), K('R-3', 'otra_solicitud', { solicitud_numero: 14 })];
  const ajuste = { texto: 'Ajuste de producción', criterios: [2], motivo: 'm' };
  const p = validateSuggestion(raw({ recomendacion: 'R-3', choques: [
    { codigo: 'R-3', origen: 'otra_solicitud', solicitud_numero: 14, tipo: 'se_solapa', explicacion: 'x' },
    { codigo: 'R-3', origen: 'produccion', tipo: 'contradice', explicacion: 'y', ajuste },
  ] }), { known: k, criterioId: 2 });
  assert.deepEqual(p.choques.map((c) => [c.origen, c.ajuste?.texto ?? null]), [['otra_solicitud', null], ['produccion', 'Ajuste de producción']]);
  assert.equal(p.recomendacion, 'R-3');
  assert.deepEqual(optionOf(p, 'R-3'), ajuste);
});

const base = [{ codigo: 'R-1', texto: 'Regla 1', criterios: [2], activa: true }];
const sel = (opcion) => ({ opcion, texto: 'T', criterios: [2], motivo: 'm', autor: 'Ana', sugerenciaId: ID });

test('applyApproval: regla nueva agrega crear con sugerencia_id', () => {
  const prev = [];
  assert.deepEqual(applyApproval(prev, base, sel('regla_nueva')), [{ op: 'crear', codigo: null, texto: 'T', criterios: [2], motivo: 'm', autor: 'Ana', sugerencia_id: ID }]);
  assert.deepEqual(prev, []);
});

test('applyApproval: ajuste de producción usa antes de la regla base; reemplaza un cambio previo conservando antes; la regla queda activa', () => {
  assert.deepEqual(applyApproval([], base, sel('R-1')), [{ op: 'modificar', codigo: 'R-1', texto: 'T', criterios: [2], activa: true, antes: { texto: 'Regla 1', criterios: [2], activa: true }, motivo: 'm', autor: 'Ana', sugerencia_id: ID }]);
  // An inactive production rule is turned back on by its approved adjustment.
  const inactive = [{ codigo: 'R-1', texto: 'Regla 1', criterios: [2], activa: false }];
  assert.deepEqual(applyApproval([], inactive, sel('R-1')), [{ op: 'modificar', codigo: 'R-1', texto: 'T', criterios: [2], activa: true, antes: { texto: 'Regla 1', criterios: [2], activa: false }, motivo: 'm', autor: 'Ana', sugerencia_id: ID }]);
  const A = { texto: 'Regla 1', criterios: [2], activa: true };
  const prev = [{ op: 'modificar', codigo: 'R-1', activa: false, antes: A, autor: 'Luis', motivo: 'old' }];
  const out = applyApproval(prev, base, sel('R-1'));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { op: 'modificar', codigo: 'R-1', texto: 'T', criterios: [2], activa: true, antes: A, motivo: 'm', autor: 'Ana', sugerencia_id: ID });
  assert.equal(prev[0].autor, 'Luis');
  const nueva = [{ op: 'crear', codigo: 'R-20', texto: 'Vieja', criterios: [1], autor: 'Luis', motivo: 'old' }];
  assert.deepEqual(applyApproval(nueva, base, sel('R-20')), [{ op: 'crear', codigo: 'R-20', texto: 'T', criterios: [2], motivo: 'm', autor: 'Ana', sugerencia_id: ID }]);
  assert.throws(() => applyApproval([], base, sel('R-77')), { statusCode: 409, message: 'La regla R-77 ya no está disponible; pide otra sugerencia.' });
});
