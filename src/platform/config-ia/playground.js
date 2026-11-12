// Config IA: playground. Compara una versión publicada contra el borrador de una solicitud
// sobre las entradas congeladas de análisis existentes. Los resultados quedan aislados en ia_pruebas*.
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from '../db.js';
import { enqueue, assertLease } from '../queue.js';
import { config } from '../../config/runtime.js';
import { engineVersion } from '../model.js';
import { buildAnalysisInputs } from '../analysis-inputs.js';
import { trackedLlm } from '../llm-tracking.js';
import { evaluarCriterio } from '../../steps/2-procesar-requerimiento/index.js';
import { planCriterios, CRITERIOS } from '../../prompt/criterios/index.js';
import { applyChanges, touchedCriteria, rulesFingerprint, normalizeAuthor, normalizeCriteria } from '../../config-ia/draft.js';
import { fail, production, versionById, versionByNumero } from './versions.js';
import { requestDetail, addEvent } from './requests.js';

export const TEST_PRIORITY = 40;
const DONE = ['complete', 'partial'];
const criterioNombre = (id) => CRITERIOS.find((c) => c.id === Number(id))?.nombre ?? `Criterio ${id}`;
const testTasks = (pruebaId, c) => query("SELECT id,estado,error,payload FROM tareas_procesamiento WHERE tipo='prueba' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.pruebaId'))=? ORDER BY created_at,id", [pruebaId], c);

/** El resultado guardado de un análisis sirve como lado de comparación solo si se produjo exactamente igual. */
export function canReuse(run, resultado, compararVersion, motorId, settings, v1Id) {
  if (resultado?.estado_tecnico !== 'complete') return false;
  if ((run.reglas_version_id ?? v1Id) !== compararVersion.id) return false;
  if (run.motor_id !== motorId) return false;
  const original = json(run.configuracion) ?? {};
  return original.analysisModel === settings.analysisModel && original.analysisEffort === settings.analysisEffort;
}

export async function createTest({ solicitudId, autor, casos, criterios, apagadas = [], compararConNumero }) {
  const who = normalizeAuthor(autor);
  if (!Array.isArray(casos) || casos.length < 1 || casos.length > 10) throw fail('Selecciona entre 1 y 10 casos.');
  if (new Set(casos.map((c) => c?.requerimientoId)).size !== casos.length) throw fail('Cada requerimiento solo puede agregarse una vez.');
  const solicitud = await requestDetail(solicitudId);
  if (['publicada', 'rechazada'].includes(solicitud.estado)) throw fail('La solicitud ya está cerrada.', 409);
  if (solicitud.borrador.conflictos.length) throw fail('Resuelve los conflictos del borrador.', 409);
  const prod = await production();
  const compare = compararConNumero ? await versionByNumero(compararConNumero) : prod;
  const off = Array.isArray(apagadas) ? [...new Set(apagadas)] : [];
  const draft = applyChanges(prod.reglas, solicitud.cambios).rules;
  if (off.some((codigo) => !draft.some((r) => r.codigo === codigo))) throw fail('Solo se pueden apagar reglas del borrador.');
  const reglasBorrador = draft.map((r) => (off.includes(r.codigo) ? { ...r, activa: false } : r));
  const ids = criterios?.length
    ? normalizeCriteria(criterios)
    : [...new Set([...touchedCriteria(prod.reglas, solicitud.cambios), ...draft.filter((r) => off.includes(r.codigo)).flatMap((r) => r.criterios)])].sort((a, b) => a - b);
  if (!ids.length) throw fail('Elige al menos un criterio.');

  const runs = [];
  for (const caso of casos) {
    const [run] = await query('SELECT e.* FROM ejecuciones e JOIN entradas_ejecucion i ON i.ejecucion_id=e.id WHERE e.id=? AND i.requerimiento_id=?', [caso?.ejecucionId ?? '', caso?.requerimientoId ?? '']);
    if (!run) throw fail('Uno de los casos no corresponde a un análisis existente.');
    const req = json(run.snapshot).requirements.find((r) => r.id === caso.requerimientoId);
    runs.push({ run, req, origen: run.id === solicitud.ejecucion_id && req.id === solicitud.requerimiento_id });
  }
  runs.sort((a, b) => Number(b.origen) - Number(a.origen));
  const exploratoria = off.length > 0 || compare.id !== prod.id || !runs.some((r) => r.origen);
  const motorId = await engineVersion(), v1 = await versionByNumero(1);

  return transaction(async (c) => {
    const id = randomUUID();
    const casosJson = runs.map(({ run, req, origen }) => ({ ejecucion_id: run.id, requerimiento_id: req.id, codigo: req.codigo, origen }));
    await query(`INSERT INTO ia_pruebas(id,solicitud_id,autor,base_version_id,comparar_version_id,reglas_comparacion,reglas_borrador,huella,exploratoria,casos,criterios,apagadas)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [id, solicitudId, who, prod.id, compare.id, JSON.stringify(compare.reglas), JSON.stringify(reglasBorrador), rulesFingerprint(reglasBorrador), exploratoria, JSON.stringify(casosJson), JSON.stringify(ids), JSON.stringify(off)], c);
    let pending = 0;
    for (const { run, req } of runs) {
      for (const criterio of planCriterios(req.ficha.tipo).filter((k) => k.aplica && ids.includes(k.id))) {
        const payload = { pruebaId: id, ejecucionId: run.id, requirementId: req.id, criterioId: criterio.id };
        const [resultado] = await query('SELECT estado_tecnico,filas FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? AND criterio_id=?', [run.id, req.id, criterio.id], c);
        if (canReuse(run, resultado, compare, motorId, config, v1.id)) {
          await query("INSERT INTO ia_pruebas_resultados(id,prueba_id,ejecucion_id,requerimiento_id,criterio_id,lado,origen,estado_tecnico,filas) VALUES (?,?,?,?,?,'produccion','reutilizado',?,?)",
            [randomUUID(), id, run.id, req.id, criterio.id, resultado.estado_tecnico, JSON.stringify(json(resultado.filas))], c);
        } else {
          await enqueue('prueba', { ...payload, lado: 'produccion' }, null, TEST_PRIORITY, c); pending++;
        }
        await enqueue('prueba', { ...payload, lado: 'borrador' }, null, TEST_PRIORITY, c); pending++;
      }
    }
    if (!pending) await query("UPDATE ia_pruebas SET estado='complete', finished_at=NOW(3) WHERE id=?", [id], c);
    if (solicitud.estado === 'pendiente') await query("UPDATE ia_solicitudes SET estado='en_prueba' WHERE id=?", [solicitudId], c);
    await addEvent(solicitudId, 'prueba_creada', who, { prueba: id, exploratoria }, c);
    return { id };
  });
}

async function finalize(pruebaId, currentTaskId, c) {
  const [{ n }] = await query("SELECT COUNT(*) n FROM tareas_procesamiento WHERE tipo='prueba' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.pruebaId'))=? AND estado IN ('queued','running') AND id<>?", [pruebaId, currentTaskId], c);
  if (Number(n)) return;
  const [{ errores }] = await query("SELECT COUNT(*) errores FROM ia_pruebas_resultados WHERE prueba_id=? AND estado_tecnico='error'", [pruebaId], c);
  const [{ fallidas }] = await query("SELECT COUNT(*) fallidas FROM tareas_procesamiento WHERE tipo='prueba' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.pruebaId'))=? AND estado='error' AND id<>?", [pruebaId, currentTaskId], c);
  await query('UPDATE ia_pruebas SET estado=?, finished_at=NOW(3) WHERE id=?', [Number(errores) || Number(fallidas) ? 'partial' : 'complete', pruebaId], c);
}

export async function processTestTask(task, llm) {
  const { pruebaId, ejecucionId, requirementId, criterioId, lado } = task.payload;
  const [prueba] = await query('SELECT * FROM ia_pruebas WHERE id=?', [pruebaId]);
  const [run] = await query('SELECT snapshot FROM ejecuciones WHERE id=?', [ejecucionId]);
  if (!prueba || !run) throw new Error('Prueba o análisis no encontrado.');
  await query("UPDATE ia_pruebas SET estado='running', finished_at=NULL WHERE id=?", [pruebaId]);
  const { tipo, ctx, buildArgs, dryMeta } = buildAnalysisInputs(json(run.snapshot), requirementId);
  const criterio = planCriterios(tipo).find((k) => k.id === criterioId);
  const rules = json(lado === 'borrador' ? prueba.reglas_borrador : prueba.reglas_comparacion);
  const result = await evaluarCriterio(criterio, {
    dryRun: false, ctx, buildArgs, dryMeta, rules,
    llm: trackedLlm(task, `prueba_c${criterioId}`, llm, config), model: config.analysisModel, reasoningEffort: config.analysisEffort,
  });
  await transaction(async (c) => {
    await assertLease(task, c);
    await query(`INSERT INTO ia_pruebas_resultados(id,prueba_id,ejecucion_id,requerimiento_id,criterio_id,lado,origen,estado_tecnico,filas) VALUES (?,?,?,?,?,?,'ejecutado',?,?) AS new
      ON DUPLICATE KEY UPDATE origen=new.origen, estado_tecnico=new.estado_tecnico, filas=new.filas`,
      [randomUUID(), pruebaId, ejecucionId, requirementId, criterioId, lado, result.error ? 'error' : 'complete', JSON.stringify(result.rows)], c);
    await finalize(pruebaId, task.id, c);
  });
}

export async function testDetail(id) {
  const [p] = await query('SELECT * FROM ia_pruebas WHERE id=?', [id]);
  if (!p) throw fail('Prueba no encontrada.', 404);
  const [results, tasks, [active], compare, base] = await Promise.all([
    query('SELECT * FROM ia_pruebas_resultados WHERE prueba_id=?', [id]), testTasks(id),
    query("SELECT COUNT(*) n FROM ejecuciones WHERE estado IN ('queued','running')"),
    versionById(p.comparar_version_id), versionById(p.base_version_id),
  ]);
  const parsedTasks = tasks.map((t) => ({ ...t, payload: json(t.payload) }));
  const side = (reqId, critId, lado) => {
    const r = results.find((x) => x.requerimiento_id === reqId && x.criterio_id === critId && x.lado === lado);
    return r ? { estado_tecnico: r.estado_tecnico, origen: r.origen, filas: json(r.filas) } : null;
  };
  const casos = json(p.casos).map((caso) => {
    const critIds = [...new Set([
      ...results.filter((r) => r.requerimiento_id === caso.requerimiento_id).map((r) => r.criterio_id),
      ...parsedTasks.filter((t) => t.payload.requirementId === caso.requerimiento_id).map((t) => t.payload.criterioId),
    ])].sort((a, b) => a - b);
    return { ...caso, criterios: critIds.map((cid) => ({ criterio_id: cid, nombre: criterioNombre(cid), produccion: side(caso.requerimiento_id, cid, 'produccion'), borrador: side(caso.requerimiento_id, cid, 'borrador') })) };
  });
  const reused = results.filter((r) => r.origen === 'reutilizado').length;
  const failedTasks = parsedTasks.filter((t) => t.estado === 'error');
  const pending = parsedTasks.filter((t) => ['queued', 'running'].includes(t.estado)).length;
  return {
    id: p.id, solicitud_id: p.solicitud_id, autor: p.autor, created_at: p.created_at, estado: p.estado, exploratoria: Boolean(p.exploratoria),
    veredicto: p.veredicto, revisor: p.revisor, comentario: p.comentario, comparar_numero: compare.numero, base_numero: base.numero,
    apagadas: json(p.apagadas), criterios: json(p.criterios),
    progreso: { total: reused + parsedTasks.length, listos: results.length, errores: results.filter((r) => r.estado_tecnico === 'error').length + failedTasks.filter((t) => !side(t.payload.requirementId, t.payload.criterioId, t.payload.lado)).length },
    casos, tareas: failedTasks.map((t) => ({ id: t.id, error: t.error })),
    en_espera: pending > 0 && Number(active.n) > 0,
  };
}

export async function recordVerdict(id, { revisor, veredicto, comentario }) {
  const who = normalizeAuthor(revisor);
  if (!['funciono', 'no_funciono'].includes(veredicto)) throw fail('Indica si el cambio funcionó o no.');
  await transaction(async (c) => {
    const [p] = await query('SELECT * FROM ia_pruebas WHERE id=? FOR UPDATE', [id], c);
    if (!p) throw fail('Prueba no encontrada.', 404);
    if (!DONE.includes(p.estado)) throw fail('Espera a que termine la prueba.', 409);
    await query('UPDATE ia_pruebas SET veredicto=?, revisor=?, comentario=? WHERE id=?', [veredicto, who, typeof comentario === 'string' ? comentario.trim() : null, id], c);
    if (!p.solicitud_id) return;
    const [s] = await query('SELECT estado FROM ia_solicitudes WHERE id=? FOR UPDATE', [p.solicitud_id], c);
    if (!p.exploratoria && !['publicada', 'rechazada'].includes(s.estado)) await query('UPDATE ia_solicitudes SET estado=? WHERE id=?', [veredicto, p.solicitud_id], c);
    await addEvent(p.solicitud_id, 'veredicto', who, { prueba: id, veredicto, exploratoria: Boolean(p.exploratoria) }, c);
  });
  return testDetail(id);
}
