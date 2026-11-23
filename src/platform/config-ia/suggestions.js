// Config IA: regla sugerida por IA. La API llama al modelo directamente, fuera de la cola de tareas y en
// segundo plano; cada sugerencia guarda en ia_sugerencias su entrada, respuesta, estado y propuesta validada.
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from '../db.js';
import { config } from '../../config/runtime.js';
import { parseLlmJsonObject } from '../../llm/parse-json.js';
import { normalizeTipo } from '../../prompt/criterios/index.js';
import { applyChanges, normalizeAuthor, validateChanges } from '../../config-ia/draft.js';
import { validateSuggestion, INVALID_SUGGESTION, optionOf, applyApproval } from '../../config-ia/suggestion.js';
import { buildSuggestionPrompt } from '../../config-ia/suggestion-prompt.js';
import { fail, versionById } from './versions.js';
import { loadRequest, addEvent, persistDraft, requestDetail } from './requests.js';

export const SUGGESTION_TIMEOUT_MS = 120000;
export const SUGGESTION_ATTEMPTS = 2;
// Más que ambos intentos y su espera: una sugerencia 'generando' más vieja quedó interrumpida (p. ej., reinicio de la API).
export const SUGGESTION_STALE_MS = 300000;
const MAX_INDICACION = 500;
const CLOSED = ['publicada', 'rechazada'];
const APPROVABLE = ['lista', 'aprobada'];
const DISCARDABLE = ['generando', 'lista', 'error'];
const AI_FAILED = 'No fue posible generar la sugerencia. Pide otra o escribe la regla a mano.';
const INTERRUPTED = 'Se interrumpió la sugerencia; pide otra.';
// La antigüedad se mide con el reloj de MySQL, el mismo que fijó created_at.
const STALE_BEFORE = `NOW(3) - INTERVAL ${SUGGESTION_STALE_MS * 1000} MICROSECOND`;
export const hideSecrets = (message) => [process.env.OPENAI_API_KEY, config.mysql.password].filter(Boolean)
  .reduce((text, secret) => text.split(secret).join('[oculto]'), String(message ?? ''));

/**
 * Reglas que la IA debe conocer: las efectivas del borrador de la solicitud (`esta_solicitud` si el borrador
 * las toca, si no `produccion`) y las que redactan las demás solicitudes abiertas (`otra_solicitud`).
 */
export async function knownRules(solicitud, c) {
  const base = await versionById(solicitud.base_version_id, c);
  const touched = new Set(solicitud.cambios.map((ch) => ch.codigo));
  const known = applyChanges(base.reglas, solicitud.cambios).rules.map((r) => ({
    codigo: r.codigo, texto: r.texto, criterios: r.criterios, activa: Boolean(r.activa),
    origen: touched.has(r.codigo) ? 'esta_solicitud' : 'produccion', solicitud_numero: null,
  }));
  const others = await query("SELECT numero, cambios FROM ia_solicitudes WHERE id<>? AND estado NOT IN ('publicada','rechazada') ORDER BY numero", [solicitud.id], c);
  for (const other of others) {
    for (const ch of json(other.cambios)) {
      if (!ch.codigo || !ch.texto) continue;
      const rule = base.reglas.find((r) => r.codigo === ch.codigo);
      known.push({
        codigo: ch.codigo, texto: ch.texto, criterios: ch.criterios ?? ch.antes?.criterios ?? rule?.criterios ?? [], activa: ch.activa ?? rule?.activa ?? true,
        origen: 'otra_solicitud', solicitud_numero: other.numero,
      });
    }
  }
  return known;
}

// Tipo del requerimiento tal como quedó congelado en el análisis del que salió la solicitud.
async function requirementType(solicitud, c) {
  const [run] = await query('SELECT snapshot FROM ejecuciones WHERE id=?', [solicitud.ejecucion_id], c);
  return normalizeTipo(run && json(run.snapshot).requirements?.find((r) => r.id === solicitud.requerimiento_id)?.ficha?.tipo);
}

/** Registra una sugerencia `generando` y la genera en segundo plano. `done` termina al guardarla y nunca rechaza. */
export async function startSuggestion(solicitudId, { autor, indicacion } = {}, llm) {
  const who = normalizeAuthor(autor);
  const hint = typeof indicacion === 'string' ? indicacion.trim() : '';
  if (hint.length > MAX_INDICACION) throw fail(`La indicación admite hasta ${MAX_INDICACION} caracteres.`);
  const job = await transaction(async (c) => {
    const solicitud = await loadRequest(solicitudId, c, true);
    if (CLOSED.includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
    const [busy] = await query(`SELECT id FROM ia_sugerencias WHERE solicitud_id=? AND estado='generando' AND created_at >= ${STALE_BEFORE} LIMIT 1`, [solicitudId], c);
    if (busy) throw fail('Ya se está generando una sugerencia.', 409);
    const [prev] = await query('SELECT propuesta FROM ia_sugerencias WHERE solicitud_id=? AND propuesta IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1', [solicitudId], c);
    // Se buscan con una lectura simple (la solicitud ya está bloqueada) y se actualizan por id: un UPDATE por
    // solicitud_id sin filas que cambiar bloquea un hueco del índice y choca con la primera sugerencia de otra solicitud.
    const replaced = (await query("SELECT id FROM ia_sugerencias WHERE solicitud_id=? AND estado IN ('generando','lista','error','aprobada')", [solicitudId], c)).map((r) => r.id);
    if (replaced.length) await query(`UPDATE ia_sugerencias SET estado='reemplazada' WHERE id IN (${replaced.map(() => '?').join(',')})`, replaced, c);
    const known = await knownRules(solicitud, c);
    const mensajes = buildSuggestionPrompt({ solicitud, tipo: await requirementType(solicitud, c), known, previa: prev ? json(prev.propuesta) : null, indicacion: hint });
    const id = randomUUID();
    await query(`INSERT INTO ia_sugerencias(id,solicitud_id,autor,indicacion,base_version_id,estado,modelo,esfuerzo,mensajes,aprobaciones)
      VALUES (?,?,?,?,?,'generando',?,?,?,'[]')`, [id, solicitudId, who, hint || null, solicitud.base_version_id, config.suggestionModel, config.suggestionEffort, JSON.stringify(mensajes)], c);
    await addEvent(solicitudId, 'sugerencia_creada', who, { sugerencia: id }, c);
    return { id, mensajes, known, criterioId: solicitud.criterio_id };
  });
  return { id: job.id, done: generate(job, llm) };
}

// Guarda el resultado solo si la sugerencia sigue generándose: una respuesta tardía no revive una reemplazada.
function finish(id, { estado, respuesta = null, uso = null, duracionMs, error = null, propuesta = null }) {
  return query("UPDATE ia_sugerencias SET estado=?, respuesta=?, uso=?, duracion_ms=?, error=?, propuesta=?, finished_at=NOW(3) WHERE id=? AND estado='generando'",
    [estado, respuesta, uso, duracionMs, error, propuesta, id]);
}

async function generate({ id, mensajes, known, criterioId }, llm) {
  const start = Date.now();
  try {
    let response;
    try {
      response = await llm({ ...mensajes, model: config.suggestionModel, reasoningEffort: config.suggestionEffort, timeoutMs: SUGGESTION_TIMEOUT_MS, maxAttempts: SUGGESTION_ATTEMPTS });
    } catch (error) {
      console.error(`Sugerencia ${id}: ${hideSecrets(error?.message)}`);
      await finish(id, { estado: 'error', error: AI_FAILED, duracionMs: Date.now() - start });
      return;
    }
    let propuesta = null;
    try { propuesta = validateSuggestion(parseLlmJsonObject(response?.rawText), { known, criterioId }); } catch (error) {
      // Queda la respuesta cruda y el aviso de sugerencia inválida; lo inesperado (JSON roto, un error del código) se registra.
      if (error?.message !== INVALID_SUGGESTION) console.error(`Sugerencia ${id}: respuesta no válida (${hideSecrets(error?.message)})`);
    }
    await finish(id, {
      estado: propuesta ? 'lista' : 'error', respuesta: response?.rawText ?? null, uso: JSON.stringify(response?.usage ?? null),
      duracionMs: Date.now() - start, error: propuesta ? null : INVALID_SUGGESTION, propuesta: propuesta && JSON.stringify(propuesta),
    });
  } catch (error) {
    console.error(`Sugerencia ${id}: no se pudo guardar el resultado (${error?.code ?? 'error interno'}).`);
  }
}

/**
 * Al arrancar la API: las sugerencias que seguían generándose quedaron sin dueño (se generan en el proceso de la API).
 * Se marcan interrumpidas para que "Pedir otra" funcione de inmediato, sin esperar SUGGESTION_STALE_MS.
 */
export async function interruptPendingSuggestions() {
  const result = await query("UPDATE ia_sugerencias SET estado='error', error=?, finished_at=NOW(3) WHERE estado='generando'", [INTERRUPTED]);
  return result.affectedRows;
}

/** Última sugerencia no reemplazada de la solicitud, como se muestra en pantalla (o null). */
export async function latestSuggestion(solicitudId, c) {
  const [solicitud] = await query('SELECT base_version_id FROM ia_solicitudes WHERE id=?', [solicitudId], c);
  if (!solicitud) throw fail('Solicitud no encontrada.', 404);
  // Solo lo que se muestra: corre en cada detalle y en cada consulta mientras se genera (sin mensajes, respuesta ni uso).
  const [row] = await query(`SELECT id, estado, base_version_id, error, autor, indicacion, created_at, propuesta, aprobaciones,
    (estado='generando' AND created_at < ${STALE_BEFORE}) interrumpida FROM ia_sugerencias
    WHERE solicitud_id=? AND estado<>'reemplazada' ORDER BY created_at DESC, id DESC LIMIT 1`, [solicitudId], c);
  if (!row) return null;
  const interrumpida = Boolean(Number(row.interrumpida));
  return {
    id: row.id, estado: interrumpida ? 'error' : row.estado,
    desactualizada: ['lista', 'aprobada'].includes(row.estado) && row.base_version_id !== solicitud.base_version_id,
    error: interrumpida ? INTERRUPTED : row.error, autor: row.autor, indicacion: row.indicacion, created_at: row.created_at,
    propuesta: row.propuesta ? json(row.propuesta) : null, aprobaciones: json(row.aprobaciones),
  };
}

// Bloquea la solicitud y después la sugerencia, en el mismo orden que startSuggestion, para que "Aprobar" y
// "Pedir otra" a la vez no se bloqueen entre sí. La solicitud de una sugerencia no cambia: se lee antes de bloquear.
async function changeSuggestion(id, change) {
  const [ref] = await query('SELECT solicitud_id FROM ia_sugerencias WHERE id=?', [id]);
  if (!ref) throw fail('Sugerencia no encontrada.', 404);
  await transaction(async (c) => {
    const solicitud = await loadRequest(ref.solicitud_id, c, true);
    const [sugerencia] = await query('SELECT * FROM ia_sugerencias WHERE id=? FOR UPDATE', [id], c);
    await change(solicitud, sugerencia, c);
  });
  return requestDetail(ref.solicitud_id);
}

/** Lleva al borrador una opción de la sugerencia ('regla_nueva' o 'R-x'), tal cual o con texto, criterios o motivo editados. */
export async function approveSuggestion(id, { autor, opcion, texto, criterios, motivo } = {}) {
  const who = normalizeAuthor(autor);
  return changeSuggestion(id, async (solicitud, sugerencia, c) => {
    if (!APPROVABLE.includes(sugerencia.estado)) throw fail('Esta sugerencia ya no se puede aprobar.', 409);
    if (CLOSED.includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
    if (sugerencia.base_version_id !== solicitud.base_version_id) throw fail('Producción cambió; pide otra sugerencia.', 409);
    const aprobaciones = json(sugerencia.aprobaciones);
    if (aprobaciones.some((a) => a.opcion === opcion)) throw fail('Esta opción ya se aprobó.', 409);
    const option = optionOf(json(sugerencia.propuesta), opcion);
    const base = await versionById(solicitud.base_version_id, c);
    const cambios = validateChanges(applyApproval(solicitud.cambios, base.reglas, {
      opcion, texto: texto ?? option.texto, criterios: criterios ?? option.criterios, motivo: motivo ?? option.motivo, autor: who, sugerenciaId: sugerencia.id,
    }));
    // applyApproval agrega la regla nueva al final; persistDraft le asigna su código.
    const approved = opcion === 'regla_nueva' ? cambios.at(-1) : cambios.find((ch) => ch.codigo === opcion);
    await persistDraft(solicitud, cambios, c);
    // Se compara ya normalizado: otros espacios u otro orden de criterios no cuentan como edición.
    const editada = ['texto', 'criterios', 'motivo'].some((k) => JSON.stringify(approved[k]) !== JSON.stringify(option[k]));
    aprobaciones.push({
      opcion, codigo: approved.codigo, editada, texto: approved.texto, criterios: approved.criterios, motivo: approved.motivo, autor: who, fecha: new Date().toISOString(),
    });
    await query("UPDATE ia_sugerencias SET estado='aprobada', aprobaciones=? WHERE id=?", [JSON.stringify(aprobaciones), sugerencia.id], c);
    await addEvent(solicitud.id, 'sugerencia_aprobada', who, { sugerencia: sugerencia.id, opcion, editada }, c);
  });
}

/** Descarta una sugerencia que aún no se aprobó; si se está generando, su respuesta ya no se guarda. */
export async function discardSuggestion(id, { autor } = {}) {
  const who = normalizeAuthor(autor);
  return changeSuggestion(id, async (solicitud, sugerencia, c) => {
    if (!DISCARDABLE.includes(sugerencia.estado)) throw fail('Esta sugerencia ya no se puede descartar.', 409);
    if (CLOSED.includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
    await query("UPDATE ia_sugerencias SET estado='descartada' WHERE id=?", [sugerencia.id], c);
    await addEvent(solicitud.id, 'sugerencia_descartada', who, { sugerencia: sugerencia.id }, c);
  });
}
