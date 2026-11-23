// Config IA: lógica pura de la regla sugerida por IA. Arma el texto de la regla, valida la
// respuesta JSON del modelo y convierte la aprobación del usuario en cambios del borrador.
import { normalizeCriteria } from './draft.js';
import { CRITERIOS } from '../prompt/criterios/index.js';

export const INVALID_SUGGESTION = 'La IA no devolvió una sugerencia válida. Pide otra o escribe la regla a mano.';
export const TIPOS_CHOQUE = ['contradice', 'duplica', 'se_solapa'];
export const TIPOS_ADVERTENCIA = ['contradice_texto_base', 'hallazgo_parece_correcto', 'problema_de_entrada', 'otra'];
const MOTIVO_DEFECTO = 'Sugerida por IA';
const invalid = () => new Error(INVALID_SUGGESTION);
const err = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const strip = (v) => str(v).replace(/\.+$/, '').trim();
const criteriosOf = (v) => { try { return normalizeCriteria(v); } catch { return null; } };

/** Arma el texto de una regla en una sola línea: `Cuando <cuando>, <hacer>.` + ` Excepción: <excepto>.` */
export function composeRuleText({ cuando, hacer, excepto } = {}) {
  const c = strip(str(cuando).replace(/^cuando\s+/i, ''));
  const h = strip(hacer);
  const e = strip(excepto);
  if (!c || !h) throw invalid();
  return `Cuando ${c}, ${h}.${e ? ` Excepción: ${e}.` : ''}`;
}

// Texto libre de un ajuste: una línea, 1 a 2000 caracteres; si no, null.
const ajusteText = (v) => { const t = str(v); return t && t.length <= 2000 ? t : null; };

function validateAjuste(a) {
  if (!a || typeof a !== 'object') return null;
  const texto = ajusteText(a.texto);
  const criterios = criteriosOf(a.criterios);
  return texto && criterios ? { texto, criterios, motivo: str(a.motivo) || MOTIVO_DEFECTO } : null;
}

// El origen lo decide el conjunto de reglas conocidas, no lo que diga la IA.
function resolveOrigin(c, known) {
  const codigo = typeof c.codigo === 'string' ? c.codigo : '';
  const others = known.filter((k) => k.codigo === codigo && k.origen === 'otra_solicitud');
  const own = known.find((k) => k.codigo === codigo && k.origen !== 'otra_solicitud');
  if (c.origen === 'otra_solicitud' && others.length) return others.find((k) => k.solicitud_numero === c.solicitud_numero) ?? others[0];
  return own ?? others[0] ?? null;
}

/** Valida la respuesta de la IA y la normaliza a una Propuesta. Lanza Error(INVALID_SUGGESTION). */
export function validateSuggestion(raw, { known, criterioId }) {
  const r = raw?.regla;
  if (!r || typeof r !== 'object') throw invalid();
  const texto = composeRuleText(r);
  const criterios = criteriosOf(r.criterios);
  if (texto.length > 2000 || !criterios) throw invalid();
  const excepto = strip(r.excepto) || null;
  const regla = { cuando: strip(str(r.cuando).replace(/^cuando\s+/i, '')), hacer: strip(r.hacer), excepto, texto, criterios, motivo: str(r.motivo) || MOTIVO_DEFECTO };

  const seen = new Set();
  const choques = [];
  for (const c of Array.isArray(raw.choques) ? raw.choques : []) {
    if (!c || typeof c !== 'object') continue;
    const k = resolveOrigin(c, known);
    if (!k) continue;
    const key = `${k.codigo}|${k.origen}|${k.solicitud_numero ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choques.push({
      codigo: k.codigo, origen: k.origen, solicitud_numero: k.origen === 'otra_solicitud' ? k.solicitud_numero ?? null : null,
      tipo: TIPOS_CHOQUE.includes(c.tipo) ? c.tipo : 'se_solapa', explicacion: str(c.explicacion),
      ajuste: k.origen === 'otra_solicitud' ? null : validateAjuste(c.ajuste),
    });
  }
  const recomendacion = choques.some((c) => c.codigo === raw.recomendacion && c.ajuste) ? raw.recomendacion : 'regla_nueva';

  const advertencias = [];
  for (const a of Array.isArray(raw.advertencias) ? raw.advertencias : []) {
    const explicacion = str(typeof a === 'string' ? a : a?.explicacion);
    if (!explicacion) continue;
    advertencias.push({ tipo: TIPOS_ADVERTENCIA.includes(a?.tipo) ? a.tipo : 'otra', explicacion });
  }
  if (!criterios.includes(criterioId)) {
    const nombre = CRITERIOS.find((c) => c.id === criterioId)?.nombre ?? `criterio ${criterioId}`;
    advertencias.push({ tipo: 'criterio_distinto', explicacion: `La regla no incluye el criterio de la solicitud (${nombre}).` });
  }
  return { entendimiento: str(raw.entendimiento), regla, choques, recomendacion, advertencias };
}

/** Texto, criterios y motivo de la opción elegida: 'regla_nueva' o el código de un choque con ajuste. */
export function optionOf(propuesta, opcion) {
  if (opcion === 'regla_nueva') { const { texto, criterios, motivo } = propuesta.regla; return { texto, criterios, motivo }; }
  const ajuste = propuesta.choques.find((c) => c.codigo === opcion)?.ajuste;
  if (!ajuste) throw err('Opción no reconocida.', 400);
  return ajuste;
}

/** Devuelve los cambios del borrador con la sugerencia aprobada aplicada (no muta los de entrada). */
export function applyApproval(cambios, baseReglas, { opcion, texto, criterios, motivo, autor, sugerenciaId }) {
  const sug = { texto, criterios, motivo, autor, sugerencia_id: sugerenciaId };
  if (opcion === 'regla_nueva') return [...cambios, { op: 'crear', codigo: null, ...sug }];
  const prev = cambios.find((c) => c.codigo === opcion);
  let next;
  if (prev?.op === 'crear') next = { op: 'crear', codigo: opcion, ...sug };
  else if (prev) next = { op: 'modificar', codigo: opcion, ...sug, ...('activa' in prev ? { activa: prev.activa } : {}), antes: prev.antes };
  else {
    const rule = baseReglas.find((r) => r.codigo === opcion);
    if (!rule) throw err(`La regla ${opcion} ya no está disponible; pide otra sugerencia.`, 409);
    next = { op: 'modificar', codigo: opcion, ...sug, antes: { texto: rule.texto, criterios: rule.criterios, activa: rule.activa } };
  }
  return prev ? cambios.map((c) => (c === prev ? next : c)) : [...cambios, next];
}
