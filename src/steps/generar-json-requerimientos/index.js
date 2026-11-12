import { config } from '../../config/runtime.js';
import path from 'node:path';
import { PATHS } from '../../config/paths.js';
import { listFiles, writeFileText, ensureDir, pathExists } from '../../helpers/fs.helper.js';
import { parseAny, SUPPORTED_EXTS } from '../../helpers/parsers/index.js';
import { logger } from '../../helpers/logger.js';
import { callOpenAI, parseLlmJsonObject } from '../../llm/index.js';
import { buildPromptConvertirRequerimientosJson } from '../../prompt/propmt-convertir-requerimientos-json/index.js';
import { normalizeTipo } from '../../prompt/criterios/index.js';

// El texto de las fichas viene desordenado (PDF a 2 columnas); reconstruir y extraer TODAS las
// consideraciones es una tarea de razonamiento difícil → modelo full + razonamiento alto.
const MODEL = config.fichaModel;
const REASONING_EFFORT = config.fichaEffort;
const CODIGO_RE = /(\d+(?:\.\d+){0,5})/;

function inferirCodigo(file) {
  const base = path.basename(file, path.extname(file));
  const match = base.match(CODIGO_RE);
  return match ? match[1] : base;
}

export function normalizeFicha(obj, { codigo }) {
  const nombre_requerimiento =
    typeof obj?.nombre_requerimiento === 'string' && obj.nombre_requerimiento.trim()
      ? obj.nombre_requerimiento.trim()
      : codigo;
  const tipo = normalizeTipo(obj?.tipo);
  const requerimientos_relacionados = Array.isArray(obj?.requerimientos_relacionados)
    ? obj.requerimientos_relacionados
        .map((r) => (typeof r === 'string' ? r.trim() : String(r ?? '').trim()))
        .filter((r) => r.length > 0)
    : [];
  const consideraciones = Array.isArray(obj?.consideraciones)
    ? obj.consideraciones
        .map((c) => (typeof c === 'string' ? c.trim() : String(c ?? '').trim()))
        .filter((c) => c.length > 0)
    : [];
  return { nombre_requerimiento, tipo, requerimientos_relacionados, consideraciones };
}

export async function runGenerarJsonRequerimientos(flags = {}) {
  logger.step('GENERAR JSON — Ficha de requerimientos (consideraciones)');

  const inputDir = PATHS.sinProcesar.requerimientos;
  const outDir = PATHS.mutable.requerimientosJson;

  if (!(await pathExists(inputDir))) {
    logger.error(`No existe ${inputDir}. Coloca los requerimientos crudos ahí.`);
    return { ok: false };
  }

  const dryRun = Boolean(flags['dry-run']);
  const soloCodigo = flags.solo && flags.solo !== true ? String(flags.solo) : null;

  if (dryRun) logger.warn('Modo DRY-RUN activo: no se llamará al LLM.');
  if (soloCodigo) logger.info(`Filtrando solo requerimiento: ${soloCodigo}`);

  const patterns = SUPPORTED_EXTS.map((e) => `**/*${e}`);
  let files = await listFiles(inputDir, patterns);

  if (soloCodigo) {
    files = files.filter((f) => inferirCodigo(f) === soloCodigo);
  }

  if (files.length === 0) {
    logger.warn(`Sin archivos a procesar en ${inputDir}.`);
    return { ok: true, generados: 0 };
  }

  await ensureDir(outDir);

  let generados = 0;
  let totalErrores = 0;

  for (const file of files) {
    const codigo = inferirCodigo(file);
    try {
      const { text } = await parseAny(file);
      const contenido = String(text ?? '').trim();

      let ficha;
      if (dryRun) {
        ficha = normalizeFicha(
          { nombre_requerimiento: codigo, consideraciones: [] },
          { codigo }
        );
      } else {
        const { system, user } = buildPromptConvertirRequerimientosJson({ codigo, contenido });
        const { rawText } = await callOpenAI({ system, user, model: MODEL, reasoningEffort: REASONING_EFFORT });
        const parsed = parseLlmJsonObject(rawText);
        ficha = normalizeFicha(parsed, { codigo });
      }

      const outFile = path.join(outDir, `${codigo}.json`);
      await writeFileText(outFile, `${JSON.stringify(ficha, null, 2)}\n`);
      generados++;
      logger.ok(
        `req ${codigo} → ${path.relative(PATHS.root, outFile)} ` +
          `[tipo: ${ficha.tipo}] (${ficha.consideraciones.length} consideración(es), ` +
          `${ficha.requerimientos_relacionados.length} relacionado(s))`
      );
    } catch (err) {
      totalErrores++;
      logger.error(`req ${codigo}: error — ${err.message}`);
    }
  }

  logger.ok(`Generación JSON finalizada: ${generados} archivo(s), ${totalErrores} error(es).`);
  return { ok: true, generados, totalErrores };
}
