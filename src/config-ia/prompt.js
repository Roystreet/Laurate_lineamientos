// Config IA: reglas adicionales que se suman al FINAL del prompt de sistema de cada criterio.
// El texto base (src/prompt/**) no se modifica; si ninguna regla activa aplica, el prompt queda idéntico.

export const RULES_HEADER = 'REGLAS ADICIONALES (OBLIGATORIAS) — Aplica estas reglas al evaluar. No modifican el FORMATO DE SALIDA ESTRICTO definido arriba.';

export const ruleNumber = (codigo) => Number(String(codigo).replace(/^R-/, ''));

/** Agrega al final de `system` las reglas activas que aplican a `criterioId`, ordenadas por número. */
export function applyRules(system, rules, criterioId) {
  const lines = (rules ?? [])
    .filter((r) => r.activa && r.criterios.includes(criterioId))
    .sort((a, b) => ruleNumber(a.codigo) - ruleNumber(b.codigo))
    .map((r) => `- [${r.codigo}] ${r.texto.replace(/\s*\n\s*/g, ' ')}`);
  if (!lines.length) return system;
  return `${system}\n\n${RULES_HEADER}\n${lines.join('\n')}`;
}
