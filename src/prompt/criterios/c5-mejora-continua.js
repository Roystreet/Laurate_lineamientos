import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
  formatoSalidaComun,
} from './_base.js';

export const NOMBRE = 'Mejora continua';

const ANALISIS = `CRITERIO A EVALUAR: Mejora continua
Aplica únicamente a informes. Evalúa, sobre el CONJUNTO de lineamientos (el/los informes), que:
1. A partir de los resultados se hayan identificado necesidades u oportunidades de mejora.
2. Se planteen acciones concretas para incorporar dichas mejoras en actividades posteriores.

Ejemplo: el informe indica que, a partir de los resultados, se ejecutarán ciertas actividades para obtener mejores resultados en el siguiente periodo. Reporta como hallazgo la ausencia de identificación de mejoras o la falta de acciones derivadas de los resultados.`;

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
