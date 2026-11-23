import test from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTION_SYSTEM, criterionFocus, buildSuggestionPrompt } from '../src/config-ia/suggestion-prompt.js';
import { CRITERIOS } from '../src/prompt/criterios/index.js';
import { SYSTEM_PROMPT as C2 } from '../src/prompt/criterios/c2-coherencia.js';

const sol = (o = {}) => ({ criterio_id: 2, requerimiento_codigo: '5.1', descripcion: 'Marcó error donde no lo hay', esperado: '', fila_copia: { id: 7, estado: 'No cumple' }, ...o });
const R = (n, o = {}) => ({ codigo: `R-${n}`, texto: 'texto', criterios: [1, 3], activa: true, origen: 'produccion', solicitud_numero: null, ...o });
const build = (o = {}) => buildSuggestionPrompt({ solicitud: sol(), tipo: 'plan', known: [], previa: null, indicacion: '', ...o });

test('criterionFocus extrae la sección del criterio sin reglas comunes ni formato', () => {
  for (const c of CRITERIOS) {
    const f = criterionFocus(c.id);
    assert.ok(f.startsWith(`CRITERIO A EVALUAR: ${c.nombre}`));
    assert.ok(!f.includes('REGLAS DE NEGOCIO INSTITUCIONALES') && !f.includes('FORMATO DE SALIDA'));
  }
});

test('SUGGESTION_SYSTEM fija reglas de redacción, choques, advertencias y formato', () => {
  for (const s of ['REGLAS ADICIONALES (OBLIGATORIAS)', 'una sola línea', 'Siempre', '"recomendacion"', 'contradice', 'duplica', 'se_solapa',
    'contradice_texto_base', 'hallazgo_parece_correcto', 'problema_de_entrada', 'esta_solicitud', 'otra_solicitud']) assert.ok(SUGGESTION_SYSTEM.includes(s), s);
});

test('SUGGESTION_SYSTEM explica cómo se arma la regla y qué hacer al pedir otra', () => {
  // How our code assembles the rule, so "cuando" and "hacer" fit the sentence.
  for (const s of ['"Cuando <cuando>, <hacer>. Excepción: <excepto>."', '"cuando" no empieza con "Cuando" ni con "si"', '"hacer" empieza en minúscula']) assert.ok(SUGGESTION_SYSTEM.includes(s), s);
  // "Pedir otra": the previous suggestion, the person's indication and replacing this request's rule.
  for (const s of ['OTRA SUGERENCIA', '<sugerencia_anterior>', '<indicacion_del_usuario>', 'no funcionar al probarla',
    'Si una regla con origen "esta_solicitud" ya intenta corregir este mismo caso, propón su reemplazo como "ajuste" de esa regla y recomiéndalo, sea cual sea el tipo de choque.']) assert.ok(SUGGESTION_SYSTEM.includes(s), s);
});

test('buildSuggestionPrompt incluye la solicitud, el hallazgo y las reglas con su origen', () => {
  const { system, user } = build({ known: [R(3), R(5, { origen: 'otra_solicitud', solicitud_numero: 14, activa: false })] });
  assert.equal(system, SUGGESTION_SYSTEM);
  assert.ok(user.includes(`<criterio_de_la_solicitud id="2" nombre="Coherencia">\n${C2}`));
  assert.ok(user.includes('<criterios_disponibles>') && user.includes('[6] Integración'));
  assert.ok(user.includes('<requerimiento codigo="5.1" tipo="plan"/>'));
  assert.ok(user.includes(`<hallazgo_reportado>\n${JSON.stringify({ id: 7, estado: 'No cumple' }, null, 2)}`));
  assert.ok(user.includes('<que_esta_mal>') && user.includes('Marcó error donde no lo hay'));
  assert.ok(user.includes('<que_esperaba>(no indicado)</que_esperaba>'));
  assert.ok(user.includes('- [R-3] (produccion, activa) criterios 1, 3: texto'));
  assert.ok(user.includes('- [R-5] (otra_solicitud #14)'));
  assert.ok(!user.includes('<sugerencia_anterior>') && !user.includes('<indicacion_del_usuario>'));
});

test('fila_copia null indica que falta un hallazgo', () => {
  const { user } = build({ solicitud: sol({ fila_copia: null }) });
  assert.ok(user.includes('Falta un hallazgo en este criterio'));
});

test('con sugerencia previa e indicación se agregan sus bloques; sin reglas dice ninguna', () => {
  const { user } = build({ previa: { regla: { texto: 'Regla previa' } }, indicacion: 'más específica' });
  assert.ok(user.includes('<sugerencia_anterior>') && user.includes('Regla previa'));
  assert.ok(user.includes('<indicacion_del_usuario>más específica'));
  assert.ok(user.includes('<reglas_existentes>\n(ninguna)'));
});
