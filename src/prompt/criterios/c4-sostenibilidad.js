import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
  formatoSalidaComun,
} from './_base.js';

export const NOMBRE = 'Sostenibilidad';

const ANALISIS = `CRITERIO A EVALUAR: Sostenibilidad
Aplica a documentos de planificación, informes y reportes de resultados. Evalúa, sobre el CONJUNTO de lineamientos, que se demuestre:
1. Establecimiento de lineamientos y planificación de las acciones.
2. Disponibilidad de recursos financieros y humanos que permitan garantizar el cumplimiento de metas y su mantenimiento en el tiempo.
3. Mecanismos de seguimiento y evaluación que aseguren la continuidad.

Reporta como hallazgo la ausencia de planificación, de asignación de recursos (financieros/humanos) o de mecanismos de seguimiento y evaluación que comprometan la sostenibilidad.`;

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
