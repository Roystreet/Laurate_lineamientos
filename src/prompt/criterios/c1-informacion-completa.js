import {
  ROL_BASE,
  REGLAS_COMUNES,
  bloqueEntradas,
  bloqueConsideraciones,
} from './_base.js';

export const NOMBRE = 'Información completa';

const ANALISIS = `CRITERIO A EVALUAR: Información completa
Determina si la evidencia tiene información trazable y cumple las consideraciones del requerimiento, no muestra alteraciones y está protegida. Evalúa, sobre el CONJUNTO de lineamientos:
1. Cumplimiento de CADA consideración del bloque <consideraciones_a_evaluar>, contrastándola contra CADA lineamiento listado en <lineamientos_ids>, UNO POR UNO.
2. Datos de aprobación e identificación: código de identificación, versión y fecha en el pie de página (NO firmas). Formato PDF. Título y datos de identificación.
3. Trazabilidad e integridad: coherencia literal entre párrafos y matrices/tablas; ausencia de alteraciones; información protegida.
4. Completitud estricta: omisiones de requisitos mínimos (p. ej. notificaciones a entidades reguladoras como Sunedu) constituyen incumplimiento.`;

const FORMATO_SALIDA = `FORMATO DE SALIDA ESTRICTO (JSON)
Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "consideraciones": [
    {
      "consideracion": "Texto EXACTO de la consideración evaluada",
      "por_lineamiento": [
        {
          "lineamiento": "ID EXACTO del lineamiento (uno de <lineamientos_ids>)",
          "cumple": "si | no",
          "literal": "SIEMPRE obligatorio, nunca N/A. Si cumple=si: cita TEXTUAL específica del fragmento del lineamiento que demuestra el cumplimiento. Si cumple=no: cita TEXTUAL del fragmento deficiente o relacionado; si la información no existe en la evidencia, indícalo explícitamente (ej. 'No se encontró en la evidencia: ...')",
          "observacion": "SIEMPRE obligatorio, nunca N/A. Si cumple=si: explica de forma breve y directa POR QUÉ cumple, refiriéndote a la cita del literal. Si cumple=no: motivo directo y específico del incumplimiento"
        }
      ]
    }
  ],
  "hallazgos_generales": [
    {
      "tipo_hallazgo": "Observación | Oportunidad de mejora | Cumple",
      "criterio_afectado": "Codificación/Versión | Formato | Trazabilidad | Información Completa | N/A",
      "lineamiento_afectado": "ID del lineamiento afectado o N/A",
      "razonamiento_previo": "Tu análisis paso a paso",
      "hallazgo": "Título + descripción directa o N/A",
      "observacion": "SIEMPRE obligatorio, nunca N/A: explica POR QUÉ cumple o POR QUÉ no cumple, según el tipo_hallazgo",
      "literal": "SIEMPRE obligatorio, nunca N/A: cita TEXTUAL específica que respalda el veredicto; si el hallazgo es por ausencia de información, indícalo explícitamente (ej. 'No se encontró en la evidencia: ...')"
    }
  ]
}

REGLAS DE SALIDA
- En "por_lineamiento" incluye TODOS los lineamientos de <lineamientos_ids>: evalúa CADA consideración contra CADA lineamiento (matriz completa). Usa los IDs EXACTOS.
- "hallazgos_generales" es para hallazgos de formato, codificación/versión, aprobación, trazabilidad o alteraciones (no ligados a una consideración puntual). Si no hay, devuelve [].
- ESCAPA correctamente comillas dobles (\\") y saltos de línea (\\n). NO incluyas texto fuera del JSON ni bloques markdown.`;

export const SYSTEM_PROMPT = `ROL DEL SISTEMA
${ROL_BASE}

${ANALISIS}

${REGLAS_COMUNES}

${FORMATO_SALIDA}`;

export function buildPrompt({ n_req, requerimiento, tipo, consideraciones, lineamientos, lineamientoIds } = {}) {
  const user =
    bloqueEntradas({ n_req, requerimiento, tipo, lineamientos, lineamientoIds }) +
    bloqueConsideraciones(consideraciones);
  return { system: SYSTEM_PROMPT, user };
}
