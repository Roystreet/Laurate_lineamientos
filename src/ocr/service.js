import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config/runtime.js';
import { callOpenAI } from '../llm/openai.client.js';
import { parseLlmJsonObject } from '../llm/parse-json.js';

const exec = promisify(execFile);
export const OCR_PROMPT = `Transcribe fielmente la página proporcionada. No evalúes cumplimiento ni resumas.
Conserva TODO el texto visible, títulos, numerales, cifras, signos, códigos, versiones y pies de página.
Reconstruye el orden de lectura. Representa tablas en Markdown conservando filas, columnas y cifras.
Nunca inventes texto. Marca los fragmentos que no pueden leerse como [ILEGIBLE].
Devuelve únicamente JSON: {"text":"transcripción literal", "blank":false, "illegible":false}.
blank=true solo cuando la página realmente está vacía. illegible=true cuando hay contenido no legible.`;

export async function renderPdfPage(file, page, directory, settings = config) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `page-${page}`);
  try {
    await exec('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(settings.ocrDpi), '-png', '-singlefile', file, target], { timeout: 120000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'OCR requiere Poppler (pdftoppm). Instala poppler o utiliza Docker.' : `No se pudo renderizar la página ${page}.`);
  }
  return `${target}.png`;
}

export async function transcribeImage(file, { settings = config, llm = callOpenAI } = {}) {
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
  const data = await fs.readFile(file);
  const response = await llm({ system: OCR_PROMPT, user: 'Transcribe esta página completa.',
    model: settings.ocrModel, reasoningEffort: settings.ocrEffort,
    images: [{ url: `data:${mime};base64,${data.toString('base64')}`, detail: settings.ocrDetail }] });
  const obj = parseLlmJsonObject(response.rawText);
  if (typeof obj.text !== 'string' || typeof obj.blank !== 'boolean' || typeof obj.illegible !== 'boolean') throw new Error('Respuesta OCR inválida: faltan text, blank o illegible.');
  if (!obj.blank && !obj.text.trim()) throw new Error('OCR devolvió una página sin transcripción.');
  return obj;
}

export async function extractPages(file, nativePages, options = {}) {
  const settings = options.settings ?? config;
  const mode = options.forceOcr ? 'always' : settings.ocrMode;
  const temp = !options.pageDir;
  const directory = options.pageDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'laureate-ocr-'));
  const pages = [];
  try {
    for (let i = 0; i < nativePages.length; i++) {
      const number = i + 1, native = nativePages[i] ?? '';
      const useful = native.replace(/\s/g, '').length;
      const isImage = /\.(png|jpe?g)$/i.test(file);
      const needsOcr = mode === 'always' || (mode === 'auto' && (isImage || useful < settings.ocrMinChars));
      const cached = options.cachedPages?.find((p) => p.page === number && ['complete', 'blank', 'illegible'].includes(p.status));
      let result;
      if (cached) result = cached;
      else if (!needsOcr) {
        if (isImage || (!useful && mode === 'off')) throw new Error(`Página ${number}: no contiene texto y OCR está desactivado.`);
        result = { page: number, method: 'native', status: 'complete', text: native, nativeText: native };
      } else {
        try {
          const image = isImage ? file : await (options.render ?? renderPdfPage)(file, number, directory, settings);
          const value = await transcribeImage(image, { settings, llm: options.llm });
          result = { page: number, method: 'ocr', status: value.blank ? 'blank' : value.illegible ? 'illegible' : 'complete', text: value.text,
            nativeText: native, imagePath: temp ? null : image };
        } catch (error) {
          await options.onPage?.({ page: number, method: 'ocr', status: 'error', text: '', nativeText: native, error: error.message });
          throw error;
        }
      }
      pages.push(result);
      await options.onPage?.(result);
    }
    return pages;
  } finally { if (temp) await fs.rm(directory, { recursive: true, force: true }); }
}
