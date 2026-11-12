import { logger } from '../../helpers/logger.js';
import { convertirRequerimientos } from './convertir-requerimiento.js';
import { convertirLineamientos } from './convertir-lineamiento.js';
import { convertirPlan } from './convertir-plan.js';

export async function runStep0(flags = {}) {
  logger.step('STEP 0 — Convertir a Markdown');
  const solo = flags.solo;

  const resultados = {};

  if (!solo || solo === 'requerimientos') {
    resultados.requerimientos = await convertirRequerimientos();
  }
  if (!solo || solo === 'lineamientos') {
    resultados.lineamientos = await convertirLineamientos();
  }
  if (!solo || solo === 'plan') {
    resultados.plan = await convertirPlan();
  }

  logger.ok(`Step 0 finalizado: ${JSON.stringify(resultados)}`);
  return resultados;
}
