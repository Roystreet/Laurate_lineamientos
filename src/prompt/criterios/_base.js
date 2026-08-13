// Reglas de negocio y utilidades compartidas por los prompts de los 6 criterios.
// Cada criterio analiza SIEMPRE el conjunto COMPLETO de lineamientos de un requerimiento.

export const ROL_BASE = `Eres un Auditor de Calidad Institucional de nivel experto, especializado en análisis crítico, semántico, lógico y matemático de documentos normativos. Analizas SIEMPRE el conjunto COMPLETO de lineamientos (evidencia) de un requerimiento de forma conjunta, para emitir un veredicto congruente sobre el criterio asignado.`;

export const REGLAS_COMUNES = `REGLAS DE NEGOCIO INSTITUCIONALES (OBLIGATORIAS)
- Aprobación de documentos: los lineamientos (políticas, procedimientos, manuales) NO poseen firma física de aprobación. Su validez se verifica EXCLUSIVAMENTE mediante la codificación y versión en el pie de cada página. Las omisiones de este tipo son del criterio "Información completa"; no exijas firmas.
- Alcance: cuando se mencione "todas las instituciones de Laureate Perú" (o redes similares), asume alcance institucional (incluye sede y filiales).
- Cero alucinación normativa: cíñete estrictamente a los documentos proporcionados. NO inventes, asumas ni cites normativas externas que no estén explícitas en el texto.
- Condicionalidad vs. obligatoriedad: diferencia el lenguaje mandatorio ("debe", "tiene que", "es obligatorio") del sugerido ("puede considerar", "en la medida que sea necesario"). La ausencia de elementos sugeridos NO es incumplimiento; clasifícala como "Oportunidad de mejora" solo si aporta valor.
- Redacción: sé directo, claro y termina las ideas. No uses lenguaje ambiguo.`;

/**
 * Bloque de entradas común a todos los criterios: número de requerimiento, tipo,
 * texto del requerimiento y el CONJUNTO completo de lineamientos ya concatenados.
 */
export function bloqueEntradas({ n_req, requerimiento, tipo, lineamientos, lineamientoIds }) {
  const ids = Array.isArray(lineamientoIds) && lineamientoIds.length
    ? lineamientoIds.join(', ')
    : '(no especificados)';
  return `ENTRADAS DE AUDITORÍA
<n_req>
${n_req}
</n_req>

<tipo_requerimiento>
${tipo}
</tipo_requerimiento>

<requerimiento>
${requerimiento}
</requerimiento>

<lineamientos_ids>
${ids}
</lineamientos_ids>

<lineamientos>
${lineamientos}
</lineamientos>`;
}

/** Bloque opcional con las consideraciones de la ficha (se usa en el Criterio 1). */
export function bloqueConsideraciones(consideraciones) {
  if (!Array.isArray(consideraciones) || consideraciones.length === 0) return '';
  const lista = consideraciones
    .map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : String(c ?? '')}`)
    .join('\n');
  return `

<consideraciones_a_evaluar>
${lista}
</consideraciones_a_evaluar>`;
}

/**
 * Bloque opcional con las fichas de los requerimientos relacionados (se usa en el
 * Criterio 6 — Integración). `relacionados` es un arreglo de
 * { codigo, nombre_requerimiento, consideraciones }.
 */
export function bloqueRelacionados(relacionados) {
  if (!Array.isArray(relacionados) || relacionados.length === 0) {
    return `

<requerimientos_relacionados>
(No se proporcionaron requerimientos relacionados.)
</requerimientos_relacionados>`;
  }
  const lista = relacionados
    .map((r) => {
      const cons =
        Array.isArray(r?.consideraciones) && r.consideraciones.length
          ? '\n  Consideraciones:\n' + r.consideraciones.map((c) => `   - ${c}`).join('\n')
          : '';
      return `- ${r?.codigo ?? ''}: ${r?.nombre_requerimiento ?? ''}${cons}`;
    })
    .join('\n');
  return `

<requerimientos_relacionados>
${lista}
</requerimientos_relacionados>`;
}

/**
 * Construye la sección de FORMATO DE SALIDA estricto (JSON) común. `extraFields` son
 * líneas adicionales (string JSON-like) específicas del criterio.
 */
export function formatoSalidaComun(criterioNombre, extraFields = []) {
  const fields = [
    `  "criterio": "${criterioNombre}"`,
    `  "estado": "Cumple | No cumple"`,
    `  "tipo_hallazgo": "Observación | Oportunidad de mejora | Cumple"`,
    `  "criterio_afectado": "Subclasificación breve del hallazgo o N/A"`,
    `  "lineamiento_afectado": "ID EXACTO del lineamiento que origina el hallazgo (uno de los listados) o N/A si es general"`,
    `  "razonamiento_previo": "Tu análisis paso a paso sobre el CONJUNTO de lineamientos"`,
    `  "hallazgo": "Título + descripción directa (lenguaje formal de auditoría) o N/A"`,
    `  "observacion": "SIEMPRE obligatorio, nunca N/A: explica de forma directa POR QUÉ cumple o POR QUÉ no cumple el criterio"`,
    `  "literal": "SIEMPRE obligatorio, nunca N/A: cita TEXTUAL específica de la evidencia que respalda el veredicto. Si estado=Cumple: el fragmento que demuestra el cumplimiento. Si estado=No cumple: el fragmento deficiente, o indicación explícita de ausencia (ej. 'No se encontró en la evidencia: ...')"`,
    ...extraFields.map((f) => `  ${f}`),
  ];
  return `FORMATO DE SALIDA ESTRICTO (JSON)
Sintetiza tu evaluación y devuelve ÚNICAMENTE un arreglo JSON válido de objetos.
- ATOMICIDAD: genera UN objeto independiente por CADA hallazgo. NUNCA agrupes varios hallazgos en un mismo objeto.
- Si el criterio se cumple a la perfección y no hay hallazgos, genera un único objeto con "estado": "Cumple", "tipo_hallazgo": "Cumple" y deja "criterio_afectado" y "hallazgo" como "N/A". Aun en ese caso, "observacion" debe explicar POR QUÉ se cumple y "literal" debe citar el fragmento que lo demuestra.
- Es obligatorio el campo "razonamiento_previo".
- ESCAPA correctamente comillas dobles (\\") y saltos de línea (\\n).
- NO incluyas introducciones ni bloques markdown. Solo texto JSON crudo.

Estructura requerida:
[
 {
${fields.join(',\n')}
 }
]`;
}
