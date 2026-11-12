// Config IA: versiones inmutables de reglas. Producción es siempre la versión de mayor número.
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from '../db.js';
import { diffRules, normalizeAuthor } from '../../config-ia/draft.js';
import { ruleNumber } from '../../config-ia/prompt.js';

export const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const parse = (v) => v && { ...v, reglas: json(v.reglas) };
export const lockCoordination = (c) => query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE', [], c);

export async function ensureInitialVersion(c) {
  await query("INSERT IGNORE INTO ia_versiones(id,numero,reglas,origen,publicado_por) VALUES (?,1,'[]','inicial','Sistema')", [randomUUID()], c);
}
export async function production(c) {
  const [v] = await query('SELECT * FROM ia_versiones ORDER BY numero DESC LIMIT 1', [], c);
  return parse(v);
}
export async function versionById(id, c) {
  const [v] = await query('SELECT * FROM ia_versiones WHERE id=?', [id], c);
  if (!v) throw fail('Versión no encontrada.', 404);
  return parse(v);
}
export async function versionByNumero(numero, c) {
  const [v] = await query('SELECT * FROM ia_versiones WHERE numero=?', [Number(numero) || 0], c);
  if (!v) throw fail('Versión no encontrada.', 404);
  return parse(v);
}
/** Reserva el siguiente código de regla (R-<n>). */
export async function allocateRuleCode(c) {
  const result = await query('INSERT INTO ia_reglas(codigo) VALUES (?)', [randomUUID().slice(0, 16)], c);
  const codigo = `R-${result.insertId}`;
  await query('UPDATE ia_reglas SET codigo=? WHERE numero=?', [codigo, result.insertId], c);
  return codigo;
}

/**
 * Crea la siguiente versión. Quien llama debe tener el bloqueo de `coordinacion`.
 * Registra el historial de cada regla cambiada y mueve los borradores abiertos a la nueva base.
 */
export async function insertVersion({ reglas, origen, solicitudId = null, revertidaDe = null, autor, motivo = null, autores = {} }, c) {
  const prev = await production(c);
  const id = randomUUID(), numero = prev.numero + 1;
  await query('INSERT INTO ia_versiones(id,numero,reglas,origen,solicitud_id,revertida_de,publicado_por,motivo) VALUES (?,?,?,?,?,?,?,?)',
    [id, numero, JSON.stringify(reglas), origen, solicitudId, revertidaDe, autor, motivo], c);
  for (const d of diffRules(prev.reglas, reglas)) {
    const who = autores[d.codigo] ?? {};
    await query('INSERT INTO ia_reglas_historial(id,codigo,version_id,accion,antes,despues,autor,motivo,solicitud_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [randomUUID(), d.codigo, id, d.accion, d.antes ? JSON.stringify(d.antes) : null, JSON.stringify(d.despues), who.autor ?? autor, who.motivo || motivo, solicitudId], c);
  }
  await query("UPDATE ia_solicitudes SET base_version_id=? WHERE estado NOT IN ('publicada','rechazada')", [id], c);
  return { id, numero };
}

export async function listVersions() {
  const rows = (await query(`SELECT v.*, s.numero solicitud_numero,
      (SELECT COUNT(*) FROM ejecuciones e WHERE e.reglas_version_id=v.id) analisis
    FROM ia_versiones v LEFT JOIN ia_solicitudes s ON s.id=v.solicitud_id ORDER BY v.numero DESC`)).map(parse);
  return rows.map((v, i) => ({
    numero: v.numero, created_at: v.created_at, publicado_por: v.publicado_por, origen: v.origen,
    solicitud_numero: v.solicitud_numero, revertida_de: v.revertida_de, motivo: v.motivo, analisis: Number(v.analisis),
    reglas: v.reglas, cambios: diffRules(rows[i + 1]?.reglas ?? [], v.reglas),
  }));
}

export async function republish(numero, { autor, motivo }) {
  const who = normalizeAuthor(autor);
  const why = typeof motivo === 'string' ? motivo.trim() : '';
  if (!why) throw fail('Indica el motivo de la reversión.');
  return transaction(async (c) => {
    await lockCoordination(c);
    const target = await versionByNumero(numero, c);
    const { numero: created } = await insertVersion({ reglas: target.reglas, origen: 'reversion', revertidaDe: target.numero, autor: who, motivo: why }, c);
    return { numero: created };
  });
}

/** Todas las reglas conocidas con su estado respecto de producción. */
export async function listRules({ criterio, estado, q } = {}) {
  const versions = (await query('SELECT numero, reglas FROM ia_versiones ORDER BY numero')).map(parse);
  const prod = versions.at(-1);
  const drafts = await query("SELECT cambios FROM ia_solicitudes WHERE estado NOT IN ('publicada','rechazada')");
  const draftRules = drafts.flatMap((d) => json(d.cambios)).filter((c) => c.op === 'crear' && c.codigo);
  const codes = (await query('SELECT codigo FROM ia_reglas ORDER BY numero')).map((r) => r.codigo);
  const out = [];
  for (const codigo of codes) {
    const inProd = prod.reglas.find((r) => r.codigo === codigo);
    const containing = versions.filter((v) => v.reglas.some((r) => r.codigo === codigo));
    const latest = containing.at(-1)?.reglas.find((r) => r.codigo === codigo);
    const draft = draftRules.find((r) => r.codigo === codigo);
    const rule = inProd ?? latest ?? (draft && { codigo, texto: draft.texto, criterios: draft.criterios, activa: false });
    if (!rule) continue;
    out.push({
      codigo, texto: rule.texto, criterios: rule.criterios, activa: Boolean(inProd?.activa),
      estado: inProd?.activa ? 'activa' : containing.length ? 'inactiva' : 'solo_borrador',
      desde: containing[0]?.numero ?? null,
    });
  }
  const text = typeof q === 'string' ? q.trim().toLowerCase() : '';
  return out
    .filter((r) => !criterio || r.criterios.includes(Number(criterio)))
    .filter((r) => !estado || r.estado === estado)
    .filter((r) => !text || r.texto.toLowerCase().includes(text) || r.codigo.toLowerCase().includes(text))
    .sort((a, b) => ruleNumber(a.codigo) - ruleNumber(b.codigo));
}

export async function ruleHistory(codigo) {
  const rows = await query(`SELECT h.accion,h.antes,h.despues,h.autor,h.motivo,h.created_at,v.numero version_numero,s.numero solicitud_numero
    FROM ia_reglas_historial h JOIN ia_versiones v ON v.id=h.version_id LEFT JOIN ia_solicitudes s ON s.id=h.solicitud_id
    WHERE h.codigo=? ORDER BY v.numero DESC`, [codigo]);
  return rows.map((r) => ({ ...r, antes: r.antes ? json(r.antes) : null, despues: json(r.despues) }));
}
