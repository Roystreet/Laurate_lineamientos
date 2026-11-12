import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../config/paths.js';
import { query, json } from './db.js';
import { storagePath, fileHash } from './storage.js';

// Delivered historical files are the authoritative artifacts. Their Markdown
// may have been converted again since delivery, changing its generated-at preview.
export async function preserveHistoricalReports(runId) {
  const [run] = await query('SELECT configuracion FROM ejecuciones WHERE id=?', [runId]);
  if(!run || !json(run.configuracion).historical) throw new Error('Solo se pueden importar entregables de una ejecución histórica.');
  for(const report of await query('SELECT * FROM reportes WHERE ejecucion_id=?', [runId])) {
    const code = path.basename(report.nombre, '.xlsx');
    const source = report.tipo === 'hallazgos' ? path.join(PATHS.inmutableHallazgos, code, report.nombre)
      : report.tipo === 'consolidado' ? path.join(PATHS.inmutableConsolidado, report.nombre)
        : path.join(PATHS.matriz, report.nombre);
    await fs.copyFile(source, storagePath(report.archivo_path));
    await query('UPDATE reportes SET sha256=? WHERE id=?', [await fileHash(source), report.id]);
  }
}
