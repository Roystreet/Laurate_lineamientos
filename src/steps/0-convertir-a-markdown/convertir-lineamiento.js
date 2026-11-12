import path from 'node:path';
import { PATHS, codigoFromReqFolder, reqFolderName } from '../../config/paths.js';
import { listDirs, listFiles, writeFileText, cleanDir } from '../../helpers/fs.helper.js';
import { parseAny, SUPPORTED_EXTS } from '../../helpers/parsers/index.js';
import { buildLineamientoMd } from '../../helpers/markdown.helper.js';
import { logger } from '../../helpers/logger.js';

export async function convertirLineamientos() {
  logger.info('Convertir lineamientos → markdown');
  const inputBase = PATHS.sinProcesar.lineamientos;
  const outputBase = PATHS.mutable.lineamientos;

  await cleanDir(outputBase);

  const reqDirs = await listDirs(inputBase);
  if (reqDirs.length === 0) {
    logger.warn(`Sin carpetas de requerimientos en ${inputBase}`);
    return { generados: 0 };
  }

  const patterns = SUPPORTED_EXTS.map((e) => `**/*${e}`);
  let generados = 0;

  for (const reqDir of reqDirs) {
    const folderName = path.basename(reqDir);
    const codigoReq = codigoFromReqFolder(folderName);
    const outDir = path.join(outputBase, reqFolderName(codigoReq));

    const files = await listFiles(reqDir, patterns);
    if (files.length === 0) {
      logger.warn(`Sin lineamientos en ${reqDir}`);
      continue;
    }

    for (const file of files) {
      try {
        const { text, meta } = await parseAny(file);
        const baseName = path.basename(file, path.extname(file));
        const idLineamiento = meta?.id || baseName;
        const md = buildLineamientoMd({
          codigoReq,
          idLineamiento,
          titulo: meta?.titulo || '',
          contenido: text,
          fuente: path.relative(PATHS.root, file),
        });
        const outFile = path.join(outDir, `${idLineamiento}.md`);
        await writeFileText(outFile, md);
        generados++;
        logger.ok(`lineamiento ${codigoReq}/${idLineamiento} → ${path.relative(PATHS.root, outFile)}`);
      } catch (err) {
        logger.error(`No se pudo procesar ${file}: ${err.message}`);
      }
    }
  }

  return { generados };
}
