import { readFileBuffer } from '../fs.helper.js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export async function parsePdf(file) {
  const buf = await readFileBuffer(file);
  const result = await pdfParse(buf);
  return { text: result.text, meta: { pages: result.numpages, info: result.info } };
}
