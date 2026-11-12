import { readFileBuffer } from '../fs.helper.js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { extractPages } from '../../ocr/service.js';

export async function parsePdf(file, options = {}) {
  const buf = await readFileBuffer(file);
  const nativePages = [];
  // Same renderer and separators as pdf-parse's default; digital PDFs remain byte-compatible.
  const result = await pdfParse(buf, { pagerender: async (page) => {
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let lastY, text = '';
    for (const item of content.items) {
      text += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
      lastY = item.transform[5];
    }
    nativePages[page.pageIndex] = text;
    return text;
  } });
  const pages = await extractPages(file, Array.from({ length: result.numpages }, (_, i) => nativePages[i] ?? ''), options);
  const text = pages.every((p) => p.method === 'native') ? result.text : pages.map((p) => `\n\n${p.text}`).join('');
  return { text, meta: { pages: result.numpages, info: result.info }, pages };
}
