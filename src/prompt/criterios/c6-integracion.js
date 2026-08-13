import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
  bloqueRelacionados,
  formatoSalidaComun,
} from './_base.js';

export const NOMBRE = 'Integración';

const ANALISIS = `CRITERIO A EVALUAR: Integración
Aplica a requerimientos tipo "lineamiento". Determina si los requerimientos de planificación, gestión y resultados están integrados en los lineamientos, de modo que se garantice su aplicación efectiva.

PREGUNTA CLAVE: ¿Los entregables —o las acciones que generan los entregables— que se esperan de los REQUERIMIENTOS RELACIONADOS están incluidos/establecidos en estos lineamientos?

CLASIFICACIÓN ("integracion"):
- "Integrado": todas las acciones/entregables de los requerimientos relacionados se establecen en los lineamientos.
- "Parcial": solo algunos se establecen.
- "No Integrado": no se establecen (total o mayoritariamente).

REGLA DE NEGOCIO: si los lineamientos NO establecen actividades vinculadas (por ejemplo: realizar la planificación, evaluar y documentar resultados), el "tipo_hallazgo" debe ser "Oportunidad de mejora" (se tratará así hasta su revisión en el siguiente periodo de evaluación), no "Observación".

Si no se proporcionaron requerimientos relacionados, indícalo en "observacion" y evalúa la integración interna con la evidencia disponible. Enumera en "requerimientos_relacionados" los códigos que consideraste.`;

export const SYSTEM_PROMPT = `ROL DEL SISTEMA
${ROL_BASE}

${ANALISIS}

${REGLAS_COMUNES}

${formatoSalidaComun(NOMBRE, [
  '"integracion": "Integrado | Parcial | No Integrado"',
  '"requerimientos_relacionados": ["códigos de requerimientos relacionados considerados"]',
])}`;

export function buildPrompt({
  n_req,
  requerimiento,
  tipo,
  consideraciones,
  lineamientos,
  lineamientoIds,
  relacionados,
} = {}) {
  const user =
    bloqueEntradas({ n_req, requerimiento, tipo, lineamientos, lineamientoIds }) +
    bloqueConsideraciones(consideraciones) +
    bloqueRelacionados(relacionados);
  return { system: SYSTEM_PROMPT, user };
}
