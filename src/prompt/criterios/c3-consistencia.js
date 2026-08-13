import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
  formatoSalidaComun,
} from './_base.js';

export const NOMBRE = 'Consistencia';

const ANALISIS = `CRITERIO A EVALUAR: Consistencia
Evalúa la solidez de la información del CONJUNTO de lineamientos:
1. Estructura clara y lógica: presencia y orden coherente de los componentes esperados según el tipo de documento (por ejemplo, en un plan: objetivos, acciones, metas, cronograma, presupuesto, indicadores, método de evaluación).
2. Justificación y sustento: el planteamiento se basa en normativa aplicable e incorpora sustento técnico.
3. Vinculación con su objetivo: cada elemento (acciones, metas, indicadores) se relaciona de forma directa con el objetivo declarado.

Escrutinio de consistencia lógica (KPIs vs objetivos): el indicador debe medir de forma directa, cuantitativa y real el impacto del objetivo asociado (compara "manzanas con manzanas"). Validación matemática y temporal: respeta encabezados de columnas (Línea Base vs Meta son momentos distintos; no busques igualdad entre ellos) y aplica sumas solo cuando la naturaleza de las actividades lo exija. Reporta inconsistencias lógicas, indicadores que son actividades disfrazadas y errores aritméticos reales.`;

export const SYSTEM_PROMPT = `ROL DEL SISTEMA
${ROL_BASE}

${ANALISIS}

${REGLAS_COMUNES}

${formatoSalidaComun(NOMBRE)}`;

export function buildPrompt({ n_req, requerimiento, tipo, consideraciones, lineamientos, lineamientoIds } = {}) {
  const user =
    bloqueEntradas({ n_req, requerimiento, tipo, lineamientos, lineamientoIds }) +
    bloqueConsideraciones(consideraciones);
  return { system: SYSTEM_PROMPT, user };
}
