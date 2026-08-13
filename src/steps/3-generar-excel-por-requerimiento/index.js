import path from 'node:path';
import ExcelJS from 'exceljs';
import { PATHS } from '../../config/paths.js';
import { listFiles, readFileText, ensureDir, pathExists } from '../../helpers/fs.helper.js';
import { logger } from '../../helpers/logger.js';

export async function runStep3() {
  logger.step('STEP 3 — Generar Excel por requerimiento');

  const jsonDir = PATHS.mutable.requerimientosJson;
  const linBase = PATHS.mutable.lineamientos;
  const outBase = PATHS.matriz;

  if (!(await pathExists(jsonDir))) {
    logger.error(`No existe ${jsonDir}. Ejecuta primero generate:formato_json_ficha_requerimientos.`);
    return { ok: false };
  }
  await ensureDir(outBase);

  const fichas = await listFiles(jsonDir, ['*.json']);
  let generados = 0;

  for (const ficha of fichas) {
    const codigo = path.basename(ficha, '.json');
    const linDir = path.join(linBase, `req_${codigo}`);
    const lins = (await pathExists(linDir)) ? await listFiles(linDir, ['*.md']) : [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`req_${codigo}`);
    ws.columns = [
      { header: 'Requerimiento', key: 'req', width: 16 },
      { header: 'ID Lineamiento', key: 'id', width: 24 },
      { header: 'Fuente', key: 'fuente', width: 40 },
      { header: 'Contenido (preview)', key: 'preview', width: 80 },
    ];

    for (const lin of lins) {
      const id = path.basename(lin, '.md');
      const text = await readFileText(lin);
      const preview = text.replace(/\s+/g, ' ').slice(0, 300);
      ws.addRow({ req: codigo, id, fuente: path.relative(PATHS.root, lin), preview });
    }

    const outFile = path.join(outBase, `req_${codigo}.xlsx`);
    await wb.xlsx.writeFile(outFile);
    generados++;
    logger.ok(`Excel req ${codigo} → ${path.relative(PATHS.root, outFile)} (${lins.length} filas)`);
  }

  logger.ok(`Step 3 finalizado: ${generados} excel(es).`);
  return { ok: true, generados };
}
