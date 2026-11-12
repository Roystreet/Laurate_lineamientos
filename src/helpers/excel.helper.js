import path from 'node:path';
import ExcelJS from 'exceljs';
import { ensureDir } from './fs.helper.js';

export const HALLAZGO_COLUMNS = [
  { header: 'n_req', key: 'n_req', width: 12 },
  { header: 'requerimiento', key: 'requerimiento', width: 50 },
  { header: 'tipo_requerimiento', key: 'tipo_requerimiento', width: 16 },
  { header: 'criterio', key: 'criterio', width: 22 },
  { header: 'lineamiento', key: 'lineamiento', width: 30 },
  { header: 'lineamientos_evaluados', key: 'lineamientos_evaluados', width: 40 },
  { header: 'estado', key: 'estado', width: 14 },
  { header: 'tipo_hallazgo', key: 'tipo_hallazgo', width: 22 },
  { header: 'criterio_afectado', key: 'criterio_afectado', width: 26 },
  { header: 'razonamiento_previo', key: 'razonamiento_previo', width: 80 },
  { header: 'hallazgo', key: 'hallazgo', width: 80 },
  { header: 'consideracion_evaluada', key: 'consideracion_evaluada', width: 70 },
  { header: 'cumple_consideracion', key: 'cumple_consideracion', width: 18 },
  { header: 'observacion', key: 'observacion', width: 70 },
  { header: 'literal', key: 'literal', width: 70 },
  { header: 'integracion', key: 'integracion', width: 16 },
  { header: 'requerimientos_relacionados', key: 'requerimientos_relacionados', width: 30 },
];

export const HALLAZGO_KEYS = HALLAZGO_COLUMNS.map((c) => c.key);

const MULTILINE_KEYS = [
  'razonamiento_previo',
  'hallazgo',
  'consideracion_evaluada',
  'observacion',
  'literal',
];

function normalizeRow(row) {
  const out = {};
  for (const k of HALLAZGO_KEYS) {
    const v = row?.[k];
    out[k] = v === undefined ? null : v;
  }
  return out;
}

export async function writeHallazgosExcel(filePath, rows, sheetName = 'hallazgos') {
  await ensureDir(path.dirname(filePath));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = HALLAZGO_COLUMNS;
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    ws.addRow(normalizeRow(row));
  }

  for (const key of MULTILINE_KEYS) {
    const col = ws.getColumn(key);
    if (col) col.alignment = { wrapText: true, vertical: 'top' };
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, rows: rows.length };
}

export async function readHallazgosExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? '').trim();
  });

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    for (const key of HALLAZGO_KEYS) obj[key] = null;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const header = headers[col];
      if (!header || !HALLAZGO_KEYS.includes(header)) return;
      const v = cell.value;
      obj[header] = v === undefined || v === '' ? null : v;
    });
    rows.push(obj);
  });

  return rows;
}

/** Logical source paths preserve the Windows separators in delivered inventories. */
export function reportSource(root, file) {
  return path.relative(root, file).split(path.sep).join('\\');
}
