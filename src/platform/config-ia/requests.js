// Config IA: solicitudes de mejora ligadas a un hallazgo, con un borrador de cambios por solicitud.
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from '../db.js';
import { CRITERIOS } from '../../prompt/criterios/index.js';
import { validateChanges, applyChanges, touchedCriteria, canPublish, normalizeAuthor } from '../../config-ia/draft.js';
import { fail, production, versionById, allocateRuleCode, insertVersion, lockCoordination } from './versions.js';

const CLOSED = ['publicada', 'rechazada'];
const criterioNombre = (id) => CRITERIOS.find((c) => c.id === Number(id))?.nombre ?? `Criterio ${id}`;
const requiredText = (value, message) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw fail(message);
  return text;
};
export async function addEvent(solicitudId, tipo, autor, detalle, c) {
  await query('INSERT INTO ia_solicitud_eventos(id,solicitud_id,tipo,autor,detalle) VALUES (?,?,?,?,?)', [randomUUID(), solicitudId, tipo, autor, detalle ? JSON.stringify(detalle) : null], c);
}
const testSummary = (t) => ({ ...t, criterios: json(t.criterios), exploratoria: Boolean(t.exploratoria) });
async function testsOf(solicitudId, c) {
  return (await query('SELECT id,base_version_id,huella,criterios,exploratoria,estado,veredicto,revisor,comentario,created_at FROM ia_pruebas WHERE solicitud_id=? ORDER BY created_at DESC', [solicitudId], c)).map(testSummary);
}
function publication(solicitud, prod, tests) {
  if (CLOSED.includes(solicitud.estado)) return { ok: false, motivo: 'La solicitud ya está cerrada.' };
  return canPublish({ production: prod, cambios: solicitud.cambios, tests });
}
async function loadRequest(id, c, lock = false) {
  const [row] = await query(`SELECT s.*, r.codigo requerimiento_codigo FROM ia_solicitudes s JOIN requerimientos r ON r.id=s.requerimiento_id WHERE s.id=?${lock ? ' FOR UPDATE' : ''}`, [id], c);
  if (!row) throw fail('Solicitud no encontrada.', 404);
  return { ...row, cambios: json(row.cambios), fila_copia: row.fila_copia ? json(row.fila_copia) : null };
}

/** Ejecuciones que incluyen el requerimiento, con sus resultados por criterio (para ligar hallazgos y elegir casos). */
export async function casesFor(requerimientoId) {
  const runs = await query(`SELECT e.id ejecucion_id, e.created_at, e.estado, v.numero reglas_version
    FROM entradas_ejecucion i JOIN ejecuciones e ON e.id=i.ejecucion_id LEFT JOIN ia_versiones v ON v.id=e.reglas_version_id
    WHERE i.requerimiento_id=? ORDER BY e.created_at DESC`, [requerimientoId ?? '']);
  for (const run of runs) {
    const results = await query('SELECT criterio_id,estado_tecnico,filas FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? ORDER BY criterio_id', [run.ejecucion_id, requerimientoId]);
    run.criterios = results.map((r) => ({ criterio_id: r.criterio_id, nombre: criterioNombre(r.criterio_id), estado_tecnico: r.estado_tecnico, filas: json(r.filas) }));
  }
  return runs;
}

export async function createRequest({ autor, descripcion, esperado, ejecucionId, requerimientoId, criterioId, filaOrden = null }) {
  const who = normalizeAuthor(autor);
  const what = requiredText(descripcion, 'Describe qué está mal.');
  const [result] = await query('SELECT filas FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? AND criterio_id=?', [ejecucionId ?? '', requerimientoId ?? '', Number(criterioId) || 0]);
  if (!result) throw fail('Selecciona un hallazgo existente.', 404);
  let copia = null;
  if (filaOrden !== null && filaOrden !== undefined) {
    copia = json(result.filas)[filaOrden];
    if (!Number.isInteger(filaOrden) || !copia) throw fail('Selecciona un hallazgo existente.');
  }
  return transaction(async (c) => {
    const id = randomUUID(), prod = await production(c);
    await query(`INSERT INTO ia_solicitudes(id,autor,descripcion,esperado,ejecucion_id,requerimiento_id,criterio_id,fila_orden,fila_copia,estado,base_version_id,cambios)
      VALUES (?,?,?,?,?,?,?,?,?,'pendiente',?,'[]')`, [id, who, what, typeof esperado === 'string' ? esperado.trim() : null, ejecucionId, requerimientoId, Number(criterioId), copia ? filaOrden : null, copia ? JSON.stringify(copia) : null, prod.id], c);
    await addEvent(id, 'creada', who, null, c);
    const [{ numero }] = await query('SELECT numero FROM ia_solicitudes WHERE id=?', [id], c);
    return { id, numero };
  });
}

export async function requestDetail(id) {
  const solicitud = await loadRequest(id);
  const [base, prod, tests, eventos] = await Promise.all([
    versionById(solicitud.base_version_id), production(), testsOf(id),
    query('SELECT tipo,autor,detalle,created_at FROM ia_solicitud_eventos WHERE solicitud_id=? ORDER BY created_at, id', [id]),
  ]);
  const { rules, conflictos } = applyChanges(base.reglas, solicitud.cambios);
  return {
    ...solicitud, criterio_nombre: criterioNombre(solicitud.criterio_id),
    borrador: { base: { numero: base.numero, reglas: base.reglas }, cambios: solicitud.cambios, reglas: rules, conflictos, criterios_tocados: touchedCriteria(base.reglas, solicitud.cambios) },
    pruebas: tests.map(({ id: testId, created_at, estado, exploratoria, veredicto, revisor, comentario }) => ({ id: testId, created_at, estado, exploratoria, veredicto, revisor, comentario })),
    eventos: eventos.map((e) => ({ ...e, detalle: e.detalle ? json(e.detalle) : null })),
    produccion_numero: prod.numero,
    publicacion: publication(solicitud, prod, tests),
  };
}

export async function listRequests() {
  const prod = await production();
  const rows = await query(`SELECT s.id,s.numero,s.autor,s.descripcion,s.estado,s.criterio_id,s.cambios,s.created_at,r.codigo requerimiento_codigo
    FROM ia_solicitudes s JOIN requerimientos r ON r.id=s.requerimiento_id ORDER BY s.numero DESC`);
  return Promise.all(rows.map(async ({ cambios, ...s }) => {
    const pub = s.estado === 'funciono' ? publication({ ...s, cambios: json(cambios) }, prod, await testsOf(s.id)) : null;
    return { ...s, estado_visible: pub?.motivo === 'Producción cambió; vuelve a probar.' ? 'requiere_reprueba' : s.estado };
  }));
}

export async function saveDraft(id, { autor, cambios }) {
  const who = normalizeAuthor(autor);
  const withAuthor = Array.isArray(cambios) ? cambios.map((c) => ({ ...c, autor: c?.autor || who })) : cambios;
  const validated = validateChanges(withAuthor);
  await transaction(async (c) => {
    const solicitud = await loadRequest(id, c, true);
    if (CLOSED.includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
    const base = await versionById(solicitud.base_version_id, c);
    for (const change of validated) {
      if (change.op === 'crear' && !change.codigo) change.codigo = await allocateRuleCode(c);
      if (change.op === 'modificar' && !change.antes) {
        const current = base.reglas.find((r) => r.codigo === change.codigo);
        if (current) change.antes = { texto: current.texto, criterios: current.criterios, activa: current.activa };
      }
    }
    await query("UPDATE ia_solicitudes SET cambios=?, estado='en_prueba' WHERE id=?", [JSON.stringify(validated), id], c);
    await addEvent(id, 'borrador_guardado', who, { cambios: validated.length }, c);
  });
  return requestDetail(id);
}

export async function rejectRequest(id, { autor, motivo }) {
  const who = normalizeAuthor(autor);
  const why = requiredText(motivo, 'Indica el motivo del rechazo.');
  await transaction(async (c) => {
    const solicitud = await loadRequest(id, c, true);
    if (CLOSED.includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
    await query("UPDATE ia_solicitudes SET estado='rechazada', motivo_rechazo=? WHERE id=?", [why, id], c);
    await addEvent(id, 'rechazada', who, { motivo: why }, c);
  });
  return requestDetail(id);
}
