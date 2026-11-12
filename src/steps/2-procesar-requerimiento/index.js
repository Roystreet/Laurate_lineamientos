import { config } from '../../config/runtime.js';
import path from 'node:path';
import { PATHS } from '../../config/paths.js';
import { listFiles, readFileText, pathExists } from '../../helpers/fs.helper.js';
import { logger } from '../../helpers/logger.js';
import { writeHallazgosExcel } from '../../helpers/excel.helper.js';
import { callOpenAI, parseLlmJson, parseLlmJsonObject } from '../../llm/index.js';
import { planCriterios, normalizeTipo } from '../../prompt/criterios/index.js';
import { applyRules } from '../../config-ia/prompt.js';

// gpt-5.4-mini: modelo de razonamiento (400k contexto, 128k salida). NO se limita la salida
// (sin max_output_tokens) para evitar respuestas acotadas; la "inteligencia" se ajusta vía
// reasoning_effort. No acepta temperature.
const MODEL = config.analysisModel;
const REASONING_EFFORT = config.analysisEffort;
// Heurístico de aviso: ~200k caracteres antes de arriesgar el contexto del modelo.
const AVISO_CHARS = 200000;

const KEY_C1 = 'informacion_completa';

/** Convierte cualquier valor del LLM a celda de texto (evita "[object Object]"). */
function cell(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(cell).filter(Boolean).join(' | ');
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}

/** Contexto fijo que se inyecta en cada fila (lo conocemos de forma autoritativa). */
export function buildContext({ codigo, requerimientoTexto, tipo, lineamientoIds }) {
  return {
    n_req: codigo,
    requerimiento: requerimientoTexto,
    tipo_requerimiento: tipo,
    lineamientos_evaluados: lineamientoIds.join(' | '),
  };
}

/** Fila con todas las claves del esquema; `over` rellena las relevantes. */
function filaBase(criterioNombre, ctx, over = {}) {
  return {
    ...ctx,
    criterio: criterioNombre,
    lineamiento: '',
    estado: '',
    tipo_hallazgo: '',
    criterio_afectado: '',
    razonamiento_previo: '',
    hallazgo: '',
    consideracion_evaluada: '',
    cumple_consideracion: '',
    observacion: '',
    literal: '',
    integracion: '',
    requerimientos_relacionados: '',
    ...over,
  };
}

/** Criterio 1 devuelve un OBJETO: matriz consideración × lineamiento + hallazgos generales. */
export function rowsFromC1(obj, criterioNombre, ctx) {
  const rows = [];
  const consideraciones = Array.isArray(obj?.consideraciones) ? obj.consideraciones : [];
  for (const c of consideraciones) {
    const texto = cell(c?.consideracion);
    const porLin = Array.isArray(c?.por_lineamiento) ? c.por_lineamiento : [];
    if (porLin.length === 0) {
      rows.push(
        filaBase(criterioNombre, ctx, {
          consideracion_evaluada: texto,
          observacion: 'El modelo no devolvió evaluación por lineamiento.',
        })
      );
      continue;
    }
    for (const pl of porLin) {
      const cumple = cell(pl?.cumple).trim().toLowerCase();
      rows.push(
        filaBase(criterioNombre, ctx, {
          lineamiento: cell(pl?.lineamiento),
          consideracion_evaluada: texto,
          cumple_consideracion: cumple,
          estado: cumple === 'si' ? 'Cumple' : 'No cumple',
          literal: cell(pl?.literal),
          observacion: cell(pl?.observacion),
        })
      );
    }
  }
  const generales = Array.isArray(obj?.hallazgos_generales) ? obj.hallazgos_generales : [];
  for (const g of generales) {
    const tipo = cell(g?.tipo_hallazgo);
    rows.push(
      filaBase(criterioNombre, ctx, {
        lineamiento: cell(g?.lineamiento_afectado),
        estado: cell(g?.estado) || (tipo === 'Cumple' ? 'Cumple' : 'No cumple'),
        tipo_hallazgo: tipo,
        criterio_afectado: cell(g?.criterio_afectado),
        razonamiento_previo: cell(g?.razonamiento_previo),
        hallazgo: cell(g?.hallazgo),
        observacion: cell(g?.observacion),
        literal: cell(g?.literal),
      })
    );
  }
  if (rows.length === 0) {
    rows.push(
      filaBase(criterioNombre, ctx, {
        estado: 'Cumple',
        tipo_hallazgo: 'Cumple',
        razonamiento_previo: 'El modelo no devolvió hallazgos para este criterio.',
      })
    );
  }
  return rows;
}

/** Criterios 2-6 devuelven un ARRAY de hallazgos (uno por objeto). */
export function rowsFromGenerico(arr, criterioNombre, ctx) {
  const rows = (Array.isArray(arr) ? arr : []).map((p) =>
    filaBase(criterioNombre, ctx, {
      lineamiento: cell(p?.lineamiento_afectado),
      estado: cell(p?.estado),
      tipo_hallazgo: cell(p?.tipo_hallazgo),
      criterio_afectado: cell(p?.criterio_afectado),
      razonamiento_previo: cell(p?.razonamiento_previo),
      hallazgo: cell(p?.hallazgo),
      observacion: cell(p?.observacion),
      literal: cell(p?.literal),
      integracion: cell(p?.integracion),
      requerimientos_relacionados: cell(p?.requerimientos_relacionados),
    })
  );
  return rows.length
    ? rows
    : [
        filaBase(criterioNombre, ctx, {
          estado: 'Cumple',
          tipo_hallazgo: 'Cumple',
          razonamiento_previo: 'El modelo no devolvió hallazgos para este criterio.',
        }),
      ];
}

export const filaNoAplica = (nombre, ctx) =>
  filaBase(nombre, ctx, {
    estado: 'No aplica',
    criterio_afectado: 'N/A',
    razonamiento_previo: `Criterio no aplicable para el tipo de requerimiento "${ctx.tipo_requerimiento}".`,
  });

export const filaError = (nombre, ctx, msg) =>
  filaBase(nombre, ctx, {
    estado: 'No cumple',
    tipo_hallazgo: 'Observación',
    criterio_afectado: 'N/A',
    razonamiento_previo: `Error al invocar LLM: ${msg}`,
    hallazgo: 'ERROR: no fue posible generar hallazgos para este criterio.',
  });

export function filasDryRun(criterio, ctx, { consideraciones, lineamientoIds }) {
  if (criterio.key === KEY_C1) {
    const rows = [];
    const cons = consideraciones.length ? consideraciones : ['(sin consideraciones)'];
    const lins = lineamientoIds.length ? lineamientoIds : ['(sin lineamiento)'];
    for (const c of cons) {
      for (const lin of lins) {
        rows.push(
          filaBase(criterio.nombre, ctx, {
            lineamiento: lin,
            consideracion_evaluada: typeof c === 'string' ? c : String(c ?? ''),
            cumple_consideracion: 'si',
            estado: 'Cumple',
            literal: '[DRY-RUN]',
          })
        );
      }
    }
    return rows;
  }
  return [
    filaBase(criterio.nombre, ctx, {
      estado: 'Cumple',
      tipo_hallazgo: 'Cumple',
      criterio_afectado: 'N/A',
      razonamiento_previo: '[DRY-RUN] No se llamó al LLM.',
      hallazgo: 'N/A',
      observacion: 'N/A',
      literal: 'N/A',
      integracion: criterio.key === 'integracion' ? 'Integrado' : '',
    }),
  ];
}

/** Carga las fichas de los requerimientos relacionados (para el Criterio 6 — Integración). */
async function cargarRelacionados(codigos, jsonBase) {
  const out = [];
  for (const cod of codigos) {
    const f = path.join(jsonBase, `${cod}.json`);
    if (await pathExists(f)) {
      try {
        const ficha = JSON.parse(await readFileText(f));
        out.push({
          codigo: cod,
          nombre_requerimiento: ficha?.nombre_requerimiento || cod,
          consideraciones: Array.isArray(ficha?.consideraciones) ? ficha.consideraciones : [],
        });
      } catch {
        out.push({ codigo: cod, nombre_requerimiento: cod, consideraciones: [] });
      }
    } else {
      out.push({ codigo: cod, nombre_requerimiento: `${cod} (ficha no encontrada)`, consideraciones: [] });
    }
  }
  return out;
}

/** Evalúa un criterio (o devuelve filas sintéticas si no aplica / dry-run / error). */
export async function evaluarCriterio(criterio, { dryRun, ctx, buildArgs, dryMeta, llm = callOpenAI, model = MODEL, reasoningEffort = REASONING_EFFORT, rules = [] }) {
  if (!criterio.aplica) {
    return { criterio, rows: [filaNoAplica(criterio.nombre, ctx)], llamado: false, error: false };
  }
  if (dryRun) {
    return { criterio, rows: filasDryRun(criterio, ctx, dryMeta), llamado: false, error: false };
  }
  try {
    const built = criterio.build(buildArgs);
    const system = applyRules(built.system, rules, criterio.id);
    const { user } = built;
    const { rawText } = await llm({
      system,
      user,
      model,
      reasoningEffort,
    });
    const rows =
      criterio.key === KEY_C1
        ? rowsFromC1(parseLlmJsonObject(rawText), criterio.nombre, ctx)
        : rowsFromGenerico(parseLlmJson(rawText), criterio.nombre, ctx);
    return { criterio, rows, llamado: true, error: false };
  } catch (err) {
    return { criterio, rows: [filaError(criterio.nombre, ctx, err.message)], llamado: true, error: true };
  }
}

export async function runStep2(flags = {}, { paths = PATHS } = {}) {
  logger.step('STEP 2 — Procesar requerimiento (multi-criterio, LLM)');

  const jsonBase = paths.mutable.requerimientosJson;
  const linBase = paths.mutable.lineamientos;
  const outBase = paths.inmutableHallazgos;

  if (!(await pathExists(jsonBase))) {
    logger.error(`No existe ${jsonBase}. Ejecuta primero generate:formato_json_ficha_requerimientos.`);
    return { ok: false };
  }

  const dryRun = Boolean(flags['dry-run']);
  const soloCodigo = flags.solo && flags.solo !== true ? String(flags.solo) : null;
  const soloCriterio = flags.criterio && flags.criterio !== true ? Number(flags.criterio) : null;

  if (dryRun) logger.warn('Modo DRY-RUN activo: no se llamará al LLM.');
  if (soloCodigo) logger.info(`Filtrando solo requerimiento: ${soloCodigo}`);
  if (soloCriterio) logger.info(`Filtrando solo criterio id: ${soloCriterio}`);

  let fichaFiles = await listFiles(jsonBase, ['*.json']);
  if (soloCodigo) {
    fichaFiles = fichaFiles.filter((f) => path.basename(f, '.json') === soloCodigo);
    if (fichaFiles.length === 0) {
      logger.error(`No se encontró la ficha JSON del requerimiento ${soloCodigo} en ${jsonBase}.`);
      return { ok: false };
    }
  }

  let totalReq = 0;
  let totalCriterios = 0;
  let totalFilas = 0;
  let totalErrores = 0;

  for (const fichaFile of fichaFiles) {
    const codigo = path.basename(fichaFile, '.json');

    let requerimientoTexto = codigo;
    let tipo = 'lineamiento';
    let consideraciones = [];
    let relacionadosCodigos = [];
    try {
      const ficha = JSON.parse(await readFileText(fichaFile));
      requerimientoTexto = String(ficha?.nombre_requerimiento ?? codigo).trim() || codigo;
      tipo = normalizeTipo(ficha?.tipo);
      consideraciones = Array.isArray(ficha?.consideraciones) ? ficha.consideraciones : [];
      relacionadosCodigos = Array.isArray(ficha?.requerimientos_relacionados)
        ? ficha.requerimientos_relacionados
        : [];
    } catch (err) {
      logger.warn(
        `Requerimiento ${codigo}: no se pudo leer ${path.relative(paths.root, fichaFile)} — ${err.message}. Se omite.`
      );
      continue;
    }

    const linDir = path.join(linBase, `req_${codigo}`);
    if (!(await pathExists(linDir))) {
      logger.warn(`Requerimiento ${codigo}: no existe carpeta de lineamientos ${path.relative(paths.root, linDir)}. Se omite.`);
      continue;
    }

    const lineamientoFiles = await listFiles(linDir, ['*.md']);
    if (lineamientoFiles.length === 0) {
      logger.warn(`Requerimiento ${codigo}: no hay lineamientos. Se omite.`);
      continue;
    }

    // Concatena TODOS los lineamientos del requerimiento (análisis conjunto).
    const lineamientoIds = [];
    const partes = [];
    for (const linFile of lineamientoFiles) {
      const id = path.basename(linFile, '.md');
      lineamientoIds.push(id);
      const contenido = (await readFileText(linFile)).trim();
      partes.push(`### LINEAMIENTO: ${id}\n${contenido}`);
    }
    const lineamientosTexto = partes.join('\n\n---\n\n');
    if (lineamientosTexto.length > AVISO_CHARS) {
      logger.warn(
        `Requerimiento ${codigo}: lineamientos muy extensos (${lineamientosTexto.length} chars); podría exceder el contexto del modelo.`
      );
    }

    let plan = planCriterios(tipo);
    if (soloCriterio) plan = plan.filter((c) => c.id === soloCriterio);

    const integracionAplica = plan.some((c) => c.key === 'integracion' && c.aplica);
    let relacionados = [];
    if (integracionAplica && !dryRun && relacionadosCodigos.length) {
      relacionados = await cargarRelacionados(relacionadosCodigos, jsonBase);
    }

    const ctx = buildContext({ codigo, requerimientoTexto, tipo, lineamientoIds });
    const buildArgs = {
      n_req: codigo,
      requerimiento: requerimientoTexto,
      tipo,
      consideraciones,
      lineamientos: lineamientosTexto,
      lineamientoIds,
      relacionados,
    };
    const dryMeta = { consideraciones, lineamientoIds };

    const aplicables = plan.filter((c) => c.aplica).map((c) => c.nombre);
    logger.info(
      `Requerimiento ${codigo} [tipo: ${tipo}] — ${lineamientoFiles.length} lineamiento(s); criterios: ${aplicables.join(', ') || '(ninguno)'}`
    );
    totalReq++;

    // Los criterios aplicables se evalúan EN PARALELO (no aplicables/dry resuelven al instante).
    const results = await Promise.all(
      plan.map((c) => evaluarCriterio(c, { dryRun, ctx, buildArgs, dryMeta }))
    );

    const rowsAcumuladas = [];
    for (const r of results) {
      rowsAcumuladas.push(...r.rows);
      if (r.llamado) totalCriterios++;
      if (r.error) {
        totalErrores++;
        logger.error(`  · ${r.criterio.nombre}: error LLM`);
      } else if (!r.criterio.aplica) {
        logger.info(`  · ${r.criterio.nombre}: no aplica`);
      } else {
        logger.ok(`  · ${r.criterio.nombre}: ${r.rows.length} fila(s)`);
      }
    }

    const outFile = path.join(outBase, codigo, `${codigo}.xlsx`);
    await writeHallazgosExcel(outFile, rowsAcumuladas);
    totalFilas += rowsAcumuladas.length;
    logger.ok(`Excel hallazgos → ${path.relative(paths.root, outFile)} (${rowsAcumuladas.length} fila(s))`);
  }

  logger.ok(
    `Step 2 finalizado: ${totalReq} req, ${totalCriterios} llamada(s) LLM, ${totalFilas} fila(s), ${totalErrores} error(es).`
  );
  return { ok: true, totalReq, totalCriterios, totalFilas, totalErrores };
}
