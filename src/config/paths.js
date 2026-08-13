import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..', '..');

export const DATA = path.join(ROOT, 'data');

export const PATHS = {
  root: ROOT,
  data: DATA,
  inmutable: path.join(DATA, 'inmutable'),
  inmutableHallazgos: path.join(DATA, 'inmutable', 'lineamiento-hallazgo'),
  inmutableConsolidado: path.join(DATA, 'inmutable', 'consolidado'),
  sinProcesar: {
    base: path.join(DATA, 'data-sin-procesar'),
    requerimientos: path.join(DATA, 'data-sin-procesar', 'requerimientos'),
    lineamientos: path.join(DATA, 'data-sin-procesar', 'lineamientos_requerimiento'),
  },
  mutable: {
    base: path.join(DATA, 'mutable'),
    requerimientos: path.join(DATA, 'mutable', 'requerimientos'),
    lineamientos: path.join(DATA, 'mutable', 'lineamientos'),
    requerimientosJson: path.join(DATA, 'mutable', 'requerimientos-json'),
  },
  matriz: path.join(DATA, 'matriz-lineamientos'),
  logs: path.join(ROOT, 'logs'),
};

export const REQ_FOLDER_PREFIX = 'req_';

export function reqFolderName(codigo) {
  return `${REQ_FOLDER_PREFIX}${codigo}`;
}

export function codigoFromReqFolder(folderName) {
  return folderName.startsWith(REQ_FOLDER_PREFIX)
    ? folderName.slice(REQ_FOLDER_PREFIX.length)
    : folderName;
}
