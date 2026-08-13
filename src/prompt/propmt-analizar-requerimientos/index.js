import { SYSTEM_PROMPT } from './template.js';

export function buildPromptAnalizarRequerimientos({ n_req, requerimiento, lineamiento, consideraciones } = {}) {
  if (!n_req) throw new Error('buildPromptAnalizarRequerimientos: "n_req" requerido.');
  if (!requerimiento) throw new Error('buildPromptAnalizarRequerimientos: "requerimiento" requerido.');
  if (!lineamiento) throw new Error('buildPromptAnalizarRequerimientos: "lineamiento" requerido.');

  const listaConsideraciones = Array.isArray(consideraciones)
    ? consideraciones.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '';

  const bloqueConsideraciones = listaConsideraciones
    ? `

<consideraciones_a_evaluar>
${listaConsideraciones}
</consideraciones_a_evaluar>`
    : '';

  const user = `ENTRADAS DE AUDITORÍA
<n_req>
${n_req}
</n_req>

<requerimiento>
${requerimiento}
</requerimiento>

<lineamiento>
${lineamiento}
</lineamiento>${bloqueConsideraciones}`;

  return { system: SYSTEM_PROMPT, user };
}

export { SYSTEM_PROMPT };
