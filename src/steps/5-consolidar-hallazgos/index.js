import path from 'node:path';
import ExcelJS from 'exceljs';
import { PATHS } from '../../config/paths.js';
import { listDirs, listFiles, pathExists, ensureDir } from '../../helpers/fs.helper.js';
import { logger } from '../../helpers/logger.js';
import { readHallazgosExcel } from '../../helpers/excel.helper.js';
import { CRITERIOS } from '../../prompt/criterios/index.js';

const NOMBRE_C1 = 'Información completa';
const ORDEN_CRITERIO = new Map(CRITERIOS.map((c, i) => [c.nombre, i]));

function strVal(v) {
  return v == null ? '' : String(v).trim();
}

/** Celda de resultado por lineamiento: solo el cumplimiento "si"/"no". */
function cumpleCell(row) {
  return strVal(row?.cumple_consideracion).toLowerCase() || '-';
}

const esNA = (s) => !s || s.trim().toUpperCase() === 'N/A';

/** Cita literal consolidada de C1: "<lineamiento>: <cita>" por cada lineamiento evaluado (cumpla o no). */
function literalC1(g) {
  const citas = [];
  for (const lin of g.lins) {
    const lit = strVal(g.byLin.get(lin)?.literal);
    if (!esNA(lit)) citas.push(`${lin}: ${lit}`);
  }
  return citas.join('\n');
}

/** Observación consolidada de C1: "<lineamiento>: <motivo>" explicando por qué cumple o no cumple. */
function observacionC1(g) {
  const motivos = [];
  for (const lin of g.lins) {
    const obs = strVal(g.byLin.get(lin)?.observacion);
    if (!esNA(obs)) motivos.push(`${lin}: ${obs}`);
  }
  return motivos.join('\n');
}

/**
 * Agrupa las filas de Información completa por (n_req + consideración) y, dentro,
 * por lineamiento (preservando orden de aparición). Devuelve grupos pivotables.
 */
function agruparMatrizC1(rows) {
  const order = [];
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.n_req}||${strVal(r.consideracion_evaluada)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        n_req: strVal(r.n_req),
        requerimiento: strVal(r.requerimiento),
        tipo_requerimiento: strVal(r.tipo_requerimiento),
        consideracion: strVal(r.consideracion_evaluada),
        lins: [],
        byLin: new Map(),
      });
      order.push(key);
    }
    const g = groups.get(key);
    const lin = strVal(r.lineamiento) || '(sin lineamiento)';
    if (!g.byLin.has(lin)) {
      g.byLin.set(lin, r);
      g.lins.push(lin);
    }
  }
  return order.map((k) => groups.get(k));
}

function buildColumns(maxGlobal) {
  const cols = [
    { header: 'n_req', key: 'n_req', width: 12 },
    { header: 'requerimiento', key: 'requerimiento', width: 45 },
    { header: 'tipo_requerimiento', key: 'tipo_requerimiento', width: 14 },
    { header: 'criterio', key: 'criterio', width: 20 },
    { header: 'detalle', key: 'detalle', width: 60 },
    { header: 'estado', key: 'estado', width: 12 },
    { header: 'literal', key: 'literal', width: 70 },
    { header: 'integracion', key: 'integracion', width: 14 },
    { header: 'tipo_hallazgo', key: 'tipo_hallazgo', width: 18 },
    { header: 'criterio_afectado', key: 'criterio_afectado', width: 22 },
    { header: 'lineamiento_afectado', key: 'lineamiento_afectado', width: 26 },
    { header: 'razonamiento_previo', key: 'razonamiento_previo', width: 70 },
    { header: 'observacion', key: 'observacion', width: 60 },
  ];
  for (let k = 1; k <= maxGlobal; k++) {
    cols.push(
      { header: `lineamiento_${k}`, key: `lineamiento_${k}`, width: 26 },
      { header: `resultado_${k}`, key: `resultado_${k}`, width: 60 }
    );
  }
  return cols;
}

function filaVacia() {
  return {
    n_req: '',
    requerimiento: '',
    tipo_requerimiento: '',
    criterio: '',
    detalle: '',
    estado: '',
    literal: '',
    integracion: '',
    tipo_hallazgo: '',
    criterio_afectado: '',
    lineamiento_afectado: '',
    razonamiento_previo: '',
    observacion: '',
  };
}

/** Convierte un grupo de matriz C1 en una fila del consolidado. */
function matrizGroupToRow(g, maxGlobal) {
  const algunoCumple = g.lins.some((lin) => strVal(g.byLin.get(lin)?.cumple_consideracion).toLowerCase() === 'si');
  const row = {
    ...filaVacia(),
    n_req: g.n_req,
    requerimiento: g.requerimiento,
    tipo_requerimiento: g.tipo_requerimiento,
    criterio: NOMBRE_C1,
    detalle: g.consideracion,
    estado: algunoCumple ? 'Cumple' : 'No cumple',
    literal: literalC1(g),
    observacion: observacionC1(g),
  };
  for (let k = 1; k <= maxGlobal; k++) {
    const lin = g.lins[k - 1];
    row[`lineamiento_${k}`] = lin && lin !== '(sin lineamiento)' ? lin : '';
    row[`resultado_${k}`] = lin ? cumpleCell(g.byLin.get(lin)) : '';
  }
  return row;
}

/** Lineamientos evaluados de una fila de hallazgo ("id1 | id2 | ..."). */
function linsEvaluados(r) {
  return strVal(r.lineamientos_evaluados)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Convierte una fila de hallazgo (criterios 2-6 o general de C1) en fila del consolidado. */
function hallazgoToRow(r) {
  const row = {
    ...filaVacia(),
    n_req: strVal(r.n_req),
    requerimiento: strVal(r.requerimiento),
    tipo_requerimiento: strVal(r.tipo_requerimiento),
    criterio: strVal(r.criterio),
    detalle: strVal(r.hallazgo) || strVal(r.consideracion_evaluada),
    estado: strVal(r.estado),
    literal: strVal(r.literal),
    integracion: strVal(r.integracion),
    tipo_hallazgo: strVal(r.tipo_hallazgo),
    criterio_afectado: strVal(r.criterio_afectado),
    lineamiento_afectado: strVal(r.lineamiento),
    razonamiento_previo: strVal(r.razonamiento_previo),
    observacion: strVal(r.observacion),
  };
  linsEvaluados(r).forEach((lin, i) => {
    row[`lineamiento_${i + 1}`] = lin;
  });
  return row;
}

const WRAP_KEYS = new Set(['detalle', 'literal', 'razonamiento_previo', 'observacion']);

const NO_APLICA = 'NO APLICA';

/** Rellena con "NO APLICA" toda celda vacía o "N/A" de la fila, para todas las columnas. */
function rellenarNoAplica(row, keys) {
  const out = {};
  for (const key of keys) {
    const v = strVal(row[key]);
    out[key] = esNA(v) ? NO_APLICA : v;
  }
  return out;
}

export async function writeConsolidado(filePath, rows, maxGlobal) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('consolidado');
  ws.columns = buildColumns(maxGlobal);
  ws.getRow(1).font = { bold: true };

  const keys = ws.columns.map((c) => c.key);
  for (const row of rows) ws.addRow(rellenarNoAplica(row, keys));

  for (const col of ws.columns) {
    if (col?.key && WRAP_KEYS.has(col.key)) {
      col.alignment = { wrapText: true, vertical: 'top' };
    }
  }

  await wb.xlsx.writeFile(filePath);
  return rows.length;
}

export async function runStep5(flags = {}, { paths = PATHS } = {}) {
  logger.step('STEP 5 — Consolidar hallazgos (matriz por lineamiento + hallazgos)');

  const base = paths.inmutableHallazgos;
  const outDir = paths.inmutableConsolidado;

  if (!(await pathExists(base))) {
    logger.error(`No existe ${base}. Ejecuta primero step:2.`);
    return { ok: false };
  }
  await ensureDir(outDir);

  const reqDirs = (await listDirs(base)).sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true })
  );

  const allRows = [];
  let totalArchivos = 0;
  for (const dir of reqDirs) {
    const xlsxs = await listFiles(dir, ['*.xlsx']);
    for (const xlsx of xlsxs) {
      const rows = await readHallazgosExcel(xlsx);
      allRows.push(...rows);
      totalArchivos++;
      logger.info(`Leído ${path.relative(paths.root, xlsx)} (${rows.length} fila(s))`);
    }
  }

  if (allRows.length === 0) {
    logger.warn('No hay archivos de hallazgos para consolidar.');
    return { ok: false, totalArchivos: 0, totalFilas: 0 };
  }

  // Información completa con consideración → matriz; el resto (C1 general + criterios 2-6) → filas.
  const c1Matriz = allRows.filter(
    (r) => strVal(r.criterio) === NOMBRE_C1 && strVal(r.consideracion_evaluada) !== ''
  );
  const filasHallazgo = allRows.filter(
    (r) => !(strVal(r.criterio) === NOMBRE_C1 && strVal(r.consideracion_evaluada) !== '')
  );

  const grupos = agruparMatrizC1(c1Matriz);
  const maxGlobal = Math.max(
    grupos.reduce((m, g) => Math.max(m, g.lins.length), 0),
    filasHallazgo.reduce((m, r) => Math.max(m, linsEvaluados(r).length), 0)
  );

  const out = [
    ...grupos.map((g) => matrizGroupToRow(g, maxGlobal)),
    ...filasHallazgo.map(hallazgoToRow),
  ];

  // Orden estable: por requerimiento y luego por orden de criterio (1..6).
  out.sort((a, b) => {
    const ra = strVal(a.n_req);
    const rb = strVal(b.n_req);
    if (ra !== rb) return ra.localeCompare(rb, undefined, { numeric: true });
    return (ORDEN_CRITERIO.get(a.criterio) ?? 99) - (ORDEN_CRITERIO.get(b.criterio) ?? 99);
  });

  const outFile = path.join(outDir, 'consolidado.xlsx');
  const totalFilas = await writeConsolidado(outFile, out, maxGlobal);

  logger.ok(
    `Consolidado → ${path.relative(paths.root, outFile)} (${totalFilas} fila(s), ${maxGlobal} columna(s) de lineamiento, ${totalArchivos} archivo(s))`
  );
  return { ok: true, totalArchivos, totalFilas, maxLineamientos: maxGlobal };
}
