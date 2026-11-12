import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChanges, applyChanges, touchedCriteria, rulesFingerprint, diffRules, canPublish, MOTIVOS } from '../src/config-ia/draft.js';

const R = (n, criterios = [2], activa = true, texto = `Regla ${n}`) => ({ codigo: `R-${n}`, texto, criterios, activa });
const base = [R(1, [2]), R(2, [1, 3])];
const crear = (codigo, criterios = [2], texto = 'Nueva') => ({ op: 'crear', codigo, texto, criterios, autor: 'Ana', motivo: 'm' });
const modificar = (codigo, campos, antes) => ({ op: 'modificar', codigo, ...campos, antes, autor: 'Ana', motivo: 'm' });
const antesDe = (r) => ({ texto: r.texto, criterios: r.criterios, activa: r.activa });

test('applyChanges aplica crear y modificar sin tocar otras reglas', () => {
  const { rules, conflictos } = applyChanges(base, [
    crear('R-3', [4]),
    modificar('R-1', { texto: 'Editada', criterios: [2, 5], activa: false }, antesDe(base[0])),
  ]);
  assert.deepEqual(conflictos, []);
  assert.deepEqual(rules.find((r) => r.codigo === 'R-1'), { codigo: 'R-1', texto: 'Editada', criterios: [2, 5], activa: false });
  assert.deepEqual(rules.find((r) => r.codigo === 'R-2'), base[1]);
  assert.deepEqual(rules.find((r) => r.codigo === 'R-3'), { codigo: 'R-3', texto: 'Nueva', criterios: [4], activa: true });
});

test('conflictos: crear existente, modificar ausente y base cambiada', () => {
  const r = applyChanges(base, [
    crear('R-1'),
    modificar('R-9', { texto: 'x' }, { texto: 'a', criterios: [1], activa: true }),
    modificar('R-2', { texto: 'y' }, { ...antesDe(base[1]), texto: 'Viejo' }),
  ]);
  assert.deepEqual(r.conflictos.map((c) => c.motivo), [MOTIVOS.yaExiste, MOTIVOS.noExiste, MOTIVOS.cambio]);
  assert.deepEqual(r.conflictos.map((c) => c.codigo), ['R-1', 'R-9', 'R-2']);
  assert.deepEqual(r.rules, base);
  assert.equal(MOTIVOS.cambio, 'La regla cambió en producción después de editarla. Revisa y guarda de nuevo.');
  assert.equal(MOTIVOS.yaExiste, 'La regla ya existe en producción.');
  assert.equal(MOTIVOS.noExiste, 'La regla no existe en producción.');
});

test('modificar solo activa no entra en conflicto si cambió el texto en la base', () => {
  const r = applyChanges(base, [modificar('R-1', { activa: false }, { ...antesDe(base[0]), texto: 'Otro' })]);
  assert.deepEqual(r.conflictos, []);
  assert.equal(r.rules[0].activa, false);
  assert.equal(r.rules[0].texto, 'Regla 1');
});

test('validateChanges rechaza entradas inválidas y normaliza', () => {
  const bad = [
    [crear('R-3', [7])], [crear('R-3', [])], [crear('R-3', [2], '   ')], [crear('R-3', [2], 'x'.repeat(2001))],
    [crear('R-3'), modificar('R-3', { texto: 'z' }, antesDe(base[0]))], [{ op: 'borrar', codigo: 'R-1', autor: 'A' }],
    [{ ...crear('R-3'), autor: '' }], 'no-array',
  ];
  for (const cambios of bad) assert.throws(() => validateChanges(cambios), (e) => e.statusCode === 400 && typeof e.message === 'string');
  const [ok] = validateChanges([{ ...crear('R-3', [3, 1, 3]), texto: '  Hola  ' }]);
  assert.deepEqual(ok.criterios, [1, 3]);
  assert.equal(ok.texto, 'Hola');
});

test('touchedCriteria une criterios antes y después', () => {
  assert.deepEqual(touchedCriteria(base, [modificar('R-1', { criterios: [3] }, antesDe(base[0]))]), [2, 3]);
  assert.deepEqual(touchedCriteria(base, [crear('R-3', [5, 1]), modificar('R-2', { activa: false }, antesDe(base[1]))]), [1, 3, 5]);
});

test('rulesFingerprint ignora orden y cambia con el texto', () => {
  assert.equal(rulesFingerprint([base[1], base[0]]), rulesFingerprint(base));
  assert.notEqual(rulesFingerprint([{ ...base[0], texto: 'otra' }, base[1]]), rulesFingerprint(base));
  assert.match(rulesFingerprint([]), /^[0-9a-f]{64}$/);
});

test('diffRules detecta las cuatro acciones', () => {
  const prev = [R(1), R(2), R(3, [2], false)];
  const next = [{ ...R(1), texto: 'cambiada' }, { ...R(2), activa: false }, R(3), R(4)];
  assert.deepEqual(diffRules(prev, next).map((d) => [d.codigo, d.accion]), [['R-1', 'editada'], ['R-2', 'desactivada'], ['R-3', 'activada'], ['R-4', 'agregada']]);
  assert.equal(diffRules(prev, next)[3].antes, null);
});

test('canPublish: cada motivo y el caso válido', () => {
  const production = { id: 'v2', reglas: base };
  const cambios = [crear('R-3', [4])];
  const reglas = applyChanges(base, cambios).rules;
  const valid = { base_version_id: 'v2', huella: rulesFingerprint(reglas), criterios: [4], exploratoria: false, estado: 'complete', veredicto: 'funciono', created_at: '2026-01-02' };
  const motivo = (o) => canPublish({ production, cambios, tests: [valid], ...o }).motivo;
  assert.deepEqual(canPublish({ production, cambios, tests: [valid] }), { ok: true, motivo: null });
  assert.equal(motivo({ cambios: [] }), 'El borrador no tiene cambios.');
  assert.equal(motivo({ cambios: [crear('R-1')] }), 'Resuelve los conflictos del borrador.');
  assert.equal(motivo({ tests: [] }), 'Ejecuta una prueba completa del borrador.');
  assert.equal(motivo({ tests: [{ ...valid, estado: 'running' }] }), 'Espera a que termine la prueba.');
  assert.equal(motivo({ tests: [{ ...valid, base_version_id: 'v1' }] }), 'Producción cambió; vuelve a probar.');
  assert.equal(motivo({ tests: [{ ...valid, huella: 'x' }] }), 'El borrador cambió después de la prueba; vuelve a probar.');
  assert.equal(motivo({ tests: [{ ...valid, criterios: [2] }] }), 'La prueba no incluyó todos los criterios que toca el cambio.');
  assert.equal(motivo({ tests: [{ ...valid, veredicto: 'no_funciono' }] }), 'La prueba debe estar marcada como Funcionó.');
  assert.equal(motivo({ tests: [{ ...valid, veredicto: null }] }), 'La prueba debe estar marcada como Funcionó.');
  const exploratoriaReciente = { ...valid, exploratoria: true, veredicto: 'no_funciono', created_at: '2026-01-03' };
  assert.equal(canPublish({ production, cambios, tests: [exploratoriaReciente, valid] }).ok, true);
  const anteriorFallida = { ...valid, veredicto: 'no_funciono', created_at: '2026-01-01' };
  assert.equal(canPublish({ production, cambios, tests: [valid, anteriorFallida] }).ok, true);
});
