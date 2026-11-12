import path from 'node:path';
import { PATHS } from '../../config/paths.js';
import { listFiles, writeFileText, cleanDir } from '../../helpers/fs.helper.js';
import { parseAny, SUPPORTED_EXTS } from '../../helpers/parsers/index.js';
import { buildRequerimientoMd } from '../../helpers/markdown.helper.js';
import { logger } from '../../helpers/logger.js';

const CODIGO_RE = /(\d+(?:\.\d+){0,5})/;

function inferirCodigo(file) {
  const base = path.basename(file, path.extname(file));
  const match = base.match(CODIGO_RE);
  return match ? match[1] : base;
}

export async function convertirRequerimientos() {
  logger.info('Convertir requerimientos → markdown');
  const inputDir = PATHS.sinProcesar.requerimientos;
  const outputDir = PATHS.mutable.requerimientos;

  await cleanDir(outputDir);

  const patterns = SUPPORTED_EXTS.map((e) => `**/*${e}`);
  const files = await listFiles(inputDir, patterns);
  if (files.length === 0) {
    logger.warn(`Sin archivos en ${inputDir}`);
    return { generados: 0 };
  }

  let generados = 0;
  for (const file of files) {
    try {
      const { text, meta } = await parseAny(file);
      const codigo = meta?.codigo || inferirCodigo(file);
      const titulo = meta?.titulo || '';
      const md = buildRequerimientoMd({
        codigo,
        titulo,
        descripcion: meta?.descripcion || '',
        contenido: text,
        fuente: path.relative(PATHS.root, file),
      });
      const outFile = path.join(outputDir, codigo, `${codigo}.md`);
      await writeFileText(outFile, md);
      generados++;
      logger.ok(`req ${codigo} → ${path.relative(PATHS.root, outFile)}`);
    } catch (err) {
      logger.error(`No se pudo procesar ${file}: ${err.message}`);
    }
  }

  return { generados };
}
