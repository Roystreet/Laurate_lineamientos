// Config IA: lógica pura de borradores. Un borrador guarda CAMBIOS respecto de su versión base,
// así puede moverse a una nueva producción conservando lo propio y detectando conflictos.
import { createHash } from 'node:crypto';
import { ruleNumber } from './prompt.js';

export const MOTIVOS = {
  yaExiste: 'La regla ya existe en producción.',
  noExiste: 'La regla no existe en producción.',
  cambio: 'La regla cambió en producción después de editarla. Revisa y guarda de nuevo.',
};
const CAMPOS = ['texto', 'criterios', 'activa'];
const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
const byNumber = (a, b) => ruleNumber(a.codigo) - ruleNumber(b.codigo);
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function normalizeAuthor(autor) {
  const value = typeof autor === 'string' ? autor.trim() : '';
  if (!value || value.length > 100) throw bad('Escribe tu nombre (máximo 100 caracteres).');
  return value;
}
function normalizeText(texto) {
  const value = typeof texto === 'string' ? texto.trim() : '';
  if (!value || value.length > 2000) throw bad('El texto de la regla debe tener entre 1 y 2000 caracteres.');
  return value;
}
export function normalizeCriteria(criterios) {
  if (!Array.isArray(criterios) || !criterios.length || criterios.some((c) => !Number.isInteger(c) || c < 1 || c > 6)) {
    throw bad('Elige al menos un criterio válido (1 a 6).');
  }
  return [...new Set(criterios)].sort((a, b) => a - b);
}

/** Valida y normaliza la lista de cambios de un borrador. Lanza un error 400 en español. */
export function validateChanges(cambios) {
  if (!Array.isArray(cambios)) throw bad('Los cambios del borrador deben ser una lista.');
  const seen = new Set();
  return cambios.map((c) => {
    if (!c || !['crear', 'modificar'].includes(c.op)) throw bad('Tipo de cambio no reconocido.');
    const autor = normalizeAuthor(c.autor);
    const motivo = typeof c.motivo === 'string' ? c.motivo.trim() : '';
    if (c.codigo != null) {
      if (!/^R-\d+$/.test(c.codigo)) throw bad('Código de regla no válido.');
      if (seen.has(c.codigo)) throw bad(`La regla ${c.codigo} tiene más de un cambio en el borrador.`);
      seen.add(c.codigo);
    }
    if (c.op === 'crear') return { op: 'crear', codigo: c.codigo ?? null, texto: normalizeText(c.texto), criterios: normalizeCriteria(c.criterios), autor, motivo };
    if (!c.codigo) throw bad('Indica la regla que se modifica.');
    const out = { op: 'modificar', codigo: c.codigo, autor, motivo };
    if (c.texto !== undefined) out.texto = normalizeText(c.texto);
    if (c.criterios !== undefined) out.criterios = normalizeCriteria(c.criterios);
    if (c.activa !== undefined) {
      if (typeof c.activa !== 'boolean') throw bad('activa debe ser verdadero o falso.');
      out.activa = c.activa;
    }
    if (!CAMPOS.some((k) => k in out)) throw bad(`El cambio de ${c.codigo} no modifica nada.`);
    if (c.antes) out.antes = { texto: c.antes.texto, criterios: c.antes.criterios, activa: c.antes.activa };
    return out;
  });
}

/** Aplica los cambios sobre las reglas base. Un cambio en conflicto no se aplica. */
export function applyChanges(base, cambios) {
  const rules = base.map((r) => ({ ...r }));
  const conflictos = [];
  for (const c of cambios) {
    const current = rules.find((r) => r.codigo === c.codigo);
    if (c.op === 'crear') {
      if (current) { conflictos.push({ codigo: c.codigo, motivo: MOTIVOS.yaExiste }); continue; }
      rules.push({ codigo: c.codigo, texto: c.texto, criterios: c.criterios, activa: true });
      continue;
    }
    if (!current) { conflictos.push({ codigo: c.codigo, motivo: MOTIVOS.noExiste }); continue; }
    const changed = CAMPOS.filter((k) => k in c);
    if (c.antes && changed.some((k) => !sameValue(current[k], c.antes[k]))) {
      conflictos.push({ codigo: c.codigo, motivo: MOTIVOS.cambio });
      continue;
    }
    for (const k of changed) current[k] = c[k];
  }
  return { rules: rules.sort(byNumber), conflictos };
}

/** Criterios que toca el borrador: los de reglas nuevas y los de antes y después de cada modificación. */
export function touchedCriteria(base, cambios) {
  const out = new Set();
  for (const c of cambios) {
    const before = c.antes?.criterios ?? base.find((r) => r.codigo === c.codigo)?.criterios ?? [];
    for (const id of [...before, ...(c.criterios ?? [])]) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

export function rulesFingerprint(rules) {
  const normalized = [...rules].sort(byNumber).map((r) => ({ codigo: r.codigo, texto: r.texto, criterios: [...r.criterios].sort((a, b) => a - b), activa: r.activa }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** Diferencias entre dos versiones. Una regla ausente en `next` cuenta como desactivada. */
export function diffRules(prev, next) {
  const out = [];
  const codes = [...new Set([...prev, ...next].map((r) => r.codigo))].sort((a, b) => ruleNumber(a) - ruleNumber(b));
  for (const codigo of codes) {
    const antes = prev.find((r) => r.codigo === codigo) ?? null;
    const despues = next.find((r) => r.codigo === codigo) ?? (antes ? { ...antes, activa: false } : null);
    if (!antes) { out.push({ codigo, accion: 'agregada', antes: null, despues }); continue; }
    if (antes.texto !== despues.texto || !sameValue(antes.criterios, despues.criterios)) out.push({ codigo, accion: 'editada', antes, despues });
    else if (antes.activa !== despues.activa) out.push({ codigo, accion: despues.activa ? 'activada' : 'desactivada', antes, despues });
  }
  return out;
}

const DONE = ['complete', 'partial'];
/** Decide si un borrador puede publicarse según su última prueba completa (no exploratoria). */
export function canPublish({ production, cambios, tests }) {
  const no = (motivo) => ({ ok: false, motivo });
  if (!cambios.length) return no('El borrador no tiene cambios.');
  const { rules, conflictos } = applyChanges(production.reglas, cambios);
  if (conflictos.length) return no('Resuelve los conflictos del borrador.');
  const latest = tests.filter((t) => !t.exploratoria).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!latest) return no('Ejecuta una prueba completa del borrador.');
  if (!DONE.includes(latest.estado)) return no('Espera a que termine la prueba.');
  if (latest.estado !== 'complete') return no('La prueba tuvo errores; vuelve a probar.');
  if (latest.base_version_id !== production.id) return no('Producción cambió; vuelve a probar.');
  if (latest.huella !== rulesFingerprint(rules)) return no('El borrador cambió después de la prueba; vuelve a probar.');
  if (touchedCriteria(production.reglas, cambios).some((id) => !latest.criterios.includes(id))) return no('La prueba no incluyó todos los criterios que toca el cambio.');
  if (latest.veredicto !== 'funciono') return no('La prueba debe estar marcada como Funcionó.');
  return { ok: true, motivo: null };
}
