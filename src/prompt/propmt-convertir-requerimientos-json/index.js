import { SYSTEM_PROMPT } from './template.js';

export function buildPromptConvertirRequerimientosJson({ codigo, contenido } = {}) {
  if (!codigo) throw new Error('buildPromptConvertirRequerimientosJson: "codigo" requerido.');
  if (!contenido) throw new Error('buildPromptConvertirRequerimientosJson: "contenido" requerido.');

  const user = `ENTRADAS DE EXTRACCIÓN
<codigo>
${codigo}
</codigo>

<contenido>
${contenido}
</contenido>`;

  return { system: SYSTEM_PROMPT, user };
}

export { SYSTEM_PROMPT };
