import { reportSource } from '../../helpers/excel.helper.js';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PATHS, codigoFromReqFolder } from '../../config/paths.js';
import { listDirs, listFiles, readFileText, ensureDir, pathExists } from '../../helpers/fs.helper.js';
import { logger } from '../../helpers/logger.js';

export async function runStep4(flags = {}, { paths = PATHS } = {}) {
  logger.step('STEP 4 — Generar matriz total de lineamientos');

  const linBase = paths.mutable.lineamientos;
  const outBase = paths.matriz;

  if (!(await pathExists(linBase))) {
    logger.error(`No existe ${linBase}. Ejecuta primero step:0.`);
    return { ok: false };
  }
  await ensureDir(outBase);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('matriz');
  ws.columns = [
    { header: 'Requerimiento', key: 'req', width: 16 },
    { header: 'ID Lineamiento', key: 'id', width: 24 },
    { header: 'Fuente', key: 'fuente', width: 50 },
    { header: 'Preview', key: 'preview', width: 100 },
  ];

  const reqCarpetas = await listDirs(linBase);
  let total = 0;

  for (const carpeta of reqCarpetas) {
    const codigoReq = codigoFromReqFolder(path.basename(carpeta));
    const mds = await listFiles(carpeta, ['*.md']);
    for (const md of mds) {
      const id = path.basename(md, '.md');
      const text = await readFileText(md);
      const preview = text.replace(/\s+/g, ' ').slice(0, 300);
      ws.addRow({ req: codigoReq, id, fuente: reportSource(paths.root, md), preview });
      total++;
    }
  }

  const outFile = path.join(outBase, 'matriz-total-lineamientos.xlsx');
  await wb.xlsx.writeFile(outFile);
  logger.ok(`Matriz total → ${path.relative(paths.root, outFile)} (${total} filas)`);
  return { ok: true, total };
}
