// Registro central de los 6 criterios de evaluación y su aplicabilidad por tipo de
// requerimiento. El Step 2 recorre este registro para decidir qué criterios ejecutar.

import * as c1 from './c1-informacion-completa.js';
import * as c2 from './c2-coherencia.js';
import * as c3 from './c3-consistencia.js';
import * as c4 from './c4-sostenibilidad.js';
import * as c5 from './c5-mejora-continua.js';
import * as c6 from './c6-integracion.js';

/** Tipos de requerimiento reconocidos (clasificados por el LLM en el paso `generate`). */
export const TIPOS = ['lineamiento', 'plan', 'informe', 'reporte'];

export const TIPO_DEFECTO = 'lineamiento';

/**
 * Registro de criterios. `aplicaA` define para qué tipos de requerimiento corresponde
 * evaluar el criterio. Editar aquí para ajustar la matriz de aplicabilidad.
 */
export const CRITERIOS = [
  { id: 1, key: 'informacion_completa', nombre: c1.NOMBRE, aplicaA: ['lineamiento', 'plan', 'informe', 'reporte'], build: c1.buildPrompt },
  { id: 2, key: 'coherencia', nombre: c2.NOMBRE, aplicaA: ['lineamiento', 'plan', 'informe', 'reporte'], build: c2.buildPrompt },
  { id: 3, key: 'consistencia', nombre: c3.NOMBRE, aplicaA: ['lineamiento', 'plan', 'informe', 'reporte'], build: c3.buildPrompt },
  { id: 4, key: 'sostenibilidad', nombre: c4.NOMBRE, aplicaA: ['plan', 'informe', 'reporte'], build: c4.buildPrompt },
  { id: 5, key: 'mejora_continua', nombre: c5.NOMBRE, aplicaA: ['informe'], build: c5.buildPrompt },
  { id: 6, key: 'integracion', nombre: c6.NOMBRE, aplicaA: ['lineamiento'], build: c6.buildPrompt },
];

/** Normaliza un tipo arbitrario al conjunto reconocido (default `lineamiento`). */
export function normalizeTipo(tipo) {
  const t = String(tipo ?? '').trim().toLowerCase();
  return TIPOS.includes(t) ? t : TIPO_DEFECTO;
}

/**
 * Devuelve los 6 criterios con un flag `aplica` según el tipo del requerimiento.
 * Mantiene el orden del registro (1..6) para una salida estable.
 */
export function planCriterios(tipo) {
  const t = normalizeTipo(tipo);
  return CRITERIOS.map((c) => ({ ...c, aplica: c.aplicaA.includes(t) }));
}
