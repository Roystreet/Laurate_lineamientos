// Config IA: instrucción estructurada para que la IA redacte la regla sugerida de una solicitud.
// Pura: sin BD ni red. Solo importa (no modifica) los textos de src/prompt/**.
import { CRITERIOS } from '../prompt/criterios/index.js';
import { SYSTEM_PROMPT as C1 } from '../prompt/criterios/c1-informacion-completa.js';
import { SYSTEM_PROMPT as C2 } from '../prompt/criterios/c2-coherencia.js';
import { SYSTEM_PROMPT as C3 } from '../prompt/criterios/c3-consistencia.js';
import { SYSTEM_PROMPT as C4 } from '../prompt/criterios/c4-sostenibilidad.js';
import { SYSTEM_PROMPT as C5 } from '../prompt/criterios/c5-mejora-continua.js';
import { SYSTEM_PROMPT as C6 } from '../prompt/criterios/c6-integracion.js';

const PROMPTS = { 1: C1, 2: C2, 3: C3, 4: C4, 5: C5, 6: C6 };
const START = 'CRITERIO A EVALUAR';
const END = 'REGLAS DE NEGOCIO INSTITUCIONALES';

export const SUGGESTION_SYSTEM = `ROL
Eres el redactor de reglas de un auditor IA de lineamientos institucionales. Una persona reportó que un resultado del auditor está mal. Tu trabajo es redactar UNA regla que corrija ese comportamiento.

CÓMO SE USAN LAS REGLAS
- Cada regla se agrega al final de las instrucciones del criterio, bajo "REGLAS ADICIONALES (OBLIGATORIAS)", en una sola línea.
- Una regla no puede cambiar el formato de salida JSON del criterio.

CÓMO REDACTAR
- Siempre propones una regla, aunque dudes. Tus dudas van en "advertencias".
- Una regla = una conducta. General y reutilizable: no menciones el código del requerimiento, nombres de archivos ni el caso puntual salvo que sea indispensable.
- Lenguaje imperativo y directo. No inventes normativa.
- "criterios": los criterios (1 a 6) donde la regla debe aplicarse.

CHOQUES con reglas existentes (<reglas_existentes>)
- "contradice": piden conductas opuestas. "duplica": dicen lo mismo. "se_solapa": cubren parte del mismo caso con distinto alcance.
- "ajuste": solo para reglas con origen "produccion" o "esta_solicitud", nunca "otra_solicitud". Es el texto completo nuevo de esa regla, reescrito para que incluya la conducta pedida y deje de chocar; aprobar solo el ajuste debe bastar.
- "recomendacion": el código de la regla a ajustar si hay un choque "contradice" o "duplica" con ajuste; si no, "regla_nueva".

ADVERTENCIAS (tipos)
- "contradice_texto_base": lo pedido choca con las reglas de negocio o el texto base del criterio.
- "hallazgo_parece_correcto": el resultado original parece bien fundado.
- "problema_de_entrada": parece un problema de lectura del documento o de una evidencia faltante, no de las instrucciones.
- "otra".

FORMATO DE SALIDA ESTRICTO
Devuelve ÚNICAMENTE un objeto JSON, sin markdown:
{"entendimiento":"…","regla":{"cuando":"…","hacer":"…","excepto":null,"criterios":[1],"motivo":"…"},
 "choques":[{"codigo":"R-3","origen":"produccion | esta_solicitud | otra_solicitud","solicitud_numero":null,"tipo":"contradice | duplica | se_solapa","explicacion":"…","ajuste":{"texto":"…","criterios":[1],"motivo":"…"}}],
 "recomendacion":"regla_nueva","advertencias":[{"tipo":"…","explicacion":"…"}]}`;

/** Tramo del prompt del criterio entre "CRITERIO A EVALUAR" y las reglas de negocio comunes. */
export function criterionFocus(criterioId) {
  const p = PROMPTS[criterioId] ?? '';
  const a = p.indexOf(START);
  const b = p.indexOf(END);
  return p.slice(Math.max(a, 0), b < 0 ? undefined : b).trim();
}

const ruleLine = (r) => {
  const origen = r.origen === 'otra_solicitud' ? `otra_solicitud #${r.solicitud_numero}`
    : `${r.origen}, ${r.activa ? 'activa' : 'inactiva'}`;
  return `- [${r.codigo}] (${origen}) criterios ${r.criterios.join(', ')}: ${String(r.texto).replace(/\s*\n\s*/g, ' ')}`;
};

export function buildSuggestionPrompt({ solicitud, tipo, known, previa, indicacion }) {
  const crit = CRITERIOS.find((c) => c.id === solicitud.criterio_id);
  const disponibles = CRITERIOS.map((c) => `[${c.id}] ${c.nombre} — aplica a: ${c.aplicaA.join(', ')}\n${criterionFocus(c.id)}`).join('\n\n');
  const fila = solicitud.fila_copia == null
    ? 'Falta un hallazgo en este criterio: el auditor no reportó algo que debió reportar.'
    : JSON.stringify(solicitud.fila_copia, null, 2);
  const reglas = known?.length ? known.map(ruleLine).join('\n') : '(ninguna)';
  const parts = [
    `<criterio_de_la_solicitud id="${solicitud.criterio_id}" nombre="${crit?.nombre ?? ''}">\n${PROMPTS[solicitud.criterio_id] ?? ''}\n</criterio_de_la_solicitud>`,
    `<criterios_disponibles>\n${disponibles}\n</criterios_disponibles>`,
    `<requerimiento codigo="${solicitud.requerimiento_codigo}" tipo="${tipo}"/>`,
    `<hallazgo_reportado>\n${fila}\n</hallazgo_reportado>`,
    `<que_esta_mal>${solicitud.descripcion}</que_esta_mal>`,
    `<que_esperaba>${solicitud.esperado?.trim() || '(no indicado)'}</que_esperaba>`,
    `<reglas_existentes>\n${reglas}\n</reglas_existentes>`,
  ];
  if (previa) parts.push(`<sugerencia_anterior>\n${previa.regla.texto}\n</sugerencia_anterior>`);
  if (indicacion?.trim()) parts.push(`<indicacion_del_usuario>${indicacion.trim()}</indicacion_del_usuario>`);
  return { system: SUGGESTION_SYSTEM, user: parts.join('\n\n') };
}
