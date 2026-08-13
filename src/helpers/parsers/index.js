import { extOf } from '../fs.helper.js';
import { parseTxt } from './parseTxt.js';
import { parseJson } from './parseJson.js';
import { parseDocx } from './parseDocx.js';
import { parsePdf } from './parsePdf.js';
import { parseXlsx } from './parseXlsx.js';

export async function parseAny(file) {
  const ext = extOf(file);
  switch (ext) {
    case '.txt':
    case '.md':
      return parseTxt(file);
    case '.json':
      return parseJson(file);
    case '.docx':
      return parseDocx(file);
    case '.pdf':
      return parsePdf(file);
    case '.xlsx':
    case '.xlsm':
      return parseXlsx(file);
    default:
      throw new Error(`Formato no soportado: ${ext} (${file})`);
  }
}

export const SUPPORTED_EXTS = ['.txt', '.md', '.json', '.docx', '.pdf', '.xlsx', '.xlsm'];
