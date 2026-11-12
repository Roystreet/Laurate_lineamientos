import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..', '..');

export const DATA = path.join(ROOT, 'data');

export function createPaths(root = ROOT) {
  const data = path.join(root, 'data');
  return {
    root, data,
    inmutable: path.join(data, 'inmutable'),
    inmutableHallazgos: path.join(data, 'inmutable', 'lineamiento-hallazgo'),
    inmutableConsolidado: path.join(data, 'inmutable', 'consolidado'),
    sinProcesar: { base: path.join(data, 'data-sin-procesar'), requerimientos: path.join(data, 'data-sin-procesar', 'requerimientos'), lineamientos: path.join(data, 'data-sin-procesar', 'lineamientos_requerimiento') },
    mutable: { base: path.join(data, 'mutable'), requerimientos: path.join(data, 'mutable', 'requerimientos'), lineamientos: path.join(data, 'mutable', 'lineamientos'), requerimientosJson: path.join(data, 'mutable', 'requerimientos-json') },
    matriz: path.join(data, 'matriz-lineamientos'), logs: path.join(root, 'logs'),
  };
}
export const PATHS = createPaths();

export const REQ_FOLDER_PREFIX = 'req_';

export function reqFolderName(codigo) {
  return `${REQ_FOLDER_PREFIX}${codigo}`;
}

export function codigoFromReqFolder(folderName) {
  return folderName.startsWith(REQ_FOLDER_PREFIX)
    ? folderName.slice(REQ_FOLDER_PREFIX.length)
    : folderName;
}
