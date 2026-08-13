import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
  formatoSalidaComun,
} from './_base.js';

export const NOMBRE = 'Coherencia';

const ANALISIS = `CRITERIO A EVALUAR: Coherencia
Evalúa la articulación lógica del CONJUNTO de lineamientos:
1. Coherencia interna: consistencia entre los propios lineamientos y con los documentos de gestión de la Universidad que se mencionan o invocan (reglamentos, políticas, procesos, caracterizaciones). Detecta contradicciones, referencias cruzadas rotas o disposiciones que se contradicen entre documentos.
2. Coherencia externa: alineación con la normativa nacional aplicable que el propio documento cita o que es claramente exigible según el requerimiento. Verifica que el contenido respete, como mínimo, lo determinado en las disposiciones legales mencionadas.

Ejemplo: un procedimiento de convalidaciones debe guardar relación con el Reglamento de Admisión que invoca. Reporta toda inconsistencia lógica o de coherencia literal entre documentos o con la normativa citada.`;

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
