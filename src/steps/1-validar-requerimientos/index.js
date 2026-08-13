import path from 'node:path';
import { PATHS } from '../../config/paths.js';
import { listFiles, readFileText, pathExists } from '../../helpers/fs.helper.js';
import { logger } from '../../helpers/logger.js';
import { TIPOS } from '../../prompt/criterios/index.js';

export async function runStep1() {
  logger.step('STEP 1 — Validar fichas JSON de requerimientos');

  const jsonDir = PATHS.mutable.requerimientosJson;
  const linDir = PATHS.mutable.lineamientos;

  if (!(await pathExists(jsonDir))) {
    logger.error(`No existe ${jsonDir}. Ejecuta primero generate:formato_json_ficha_requerimientos.`);
    return { ok: false };
  }

  const fichas = await listFiles(jsonDir, ['*.json']);
  const errores = [];
  const warnings = [];

  if (fichas.length === 0) {
    warnings.push('No hay fichas JSON generadas.');
  }

  for (const fichaFile of fichas) {
    const codigo = path.basename(fichaFile, '.json');
    const rel = path.relative(PATHS.root, fichaFile);

    let ficha;
    try {
      ficha = JSON.parse(await readFileText(fichaFile));
    } catch (err) {
      errores.push(`${rel}: JSON inválido (${err.message})`);
      continue;
    }

    if (!ficha?.nombre_requerimiento || String(ficha.nombre_requerimiento).trim() === '') {
      errores.push(`${rel}: falta "nombre_requerimiento".`);
    }
    if (!ficha?.tipo) {
      warnings.push(`${rel}: falta "tipo"; se asumirá "lineamiento" al procesar.`);
    } else if (!TIPOS.includes(String(ficha.tipo).trim().toLowerCase())) {
      warnings.push(`${rel}: "tipo" inválido ("${ficha.tipo}"). Permitidos: ${TIPOS.join(', ')}.`);
    }
    if (ficha?.requerimientos_relacionados !== undefined && !Array.isArray(ficha.requerimientos_relacionados)) {
      errores.push(`${rel}: "requerimientos_relacionados" debe ser un arreglo.`);
    }
    if (!Array.isArray(ficha?.consideraciones)) {
      errores.push(`${rel}: "consideraciones" debe ser un arreglo.`);
    } else if (ficha.consideraciones.length === 0) {
      warnings.push(`${rel}: "consideraciones" está vacío.`);
    }

    const linCarpeta = path.join(linDir, `req_${codigo}`);
    if (!(await pathExists(linCarpeta))) {
      warnings.push(`req ${codigo}: sin carpeta de lineamientos asociada`);
    } else {
      const lins = await listFiles(linCarpeta, ['*.md']);
      if (lins.length === 0) warnings.push(`req ${codigo}: carpeta de lineamientos vacía`);
    }
  }

  if (warnings.length) warnings.forEach((w) => logger.warn(w));
  if (errores.length) {
    errores.forEach((e) => logger.error(e));
    logger.error(`Validación fallida: ${errores.length} error(es).`);
    return { ok: false, errores, warnings };
  }

  logger.ok(`Validación correcta. ${fichas.length} ficha(s) JSON.`);
  return { ok: true, errores, warnings };
}
