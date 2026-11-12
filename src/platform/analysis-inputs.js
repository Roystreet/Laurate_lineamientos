import { buildContext } from '../steps/2-procesar-requerimiento/index.js';

/** Arma, desde el snapshot congelado de una ejecución, las entradas del análisis de un requerimiento. */
export function buildAnalysisInputs(snapshot, requirementId) {
  const req = snapshot.requirements.find((r) => r.id === requirementId);
  if (!req) throw new Error('Entrada congelada no encontrada.');
  const lineamientoIds = req.evidencias.map((d) => d.lineamiento);
  const lineamientos = req.evidencias.map((d) => `### LINEAMIENTO: ${d.lineamiento}\n${d.markdown.trim()}`).join('\n\n---\n\n');
  const { nombre_requerimiento, tipo, consideraciones, requerimientos_relacionados } = req.ficha;
  const relacionados = requerimientos_relacionados.map((codigo) => {
    const related = snapshot.catalog.find((r) => r.codigo === codigo);
    return { codigo, nombre_requerimiento: related?.ficha.nombre_requerimiento ?? `${codigo} (ficha no encontrada)`, consideraciones: related?.ficha.consideraciones ?? [] };
  });
  const ctx = buildContext({ codigo: req.codigo, requerimientoTexto: nombre_requerimiento, tipo, lineamientoIds });
  const buildArgs = { n_req: req.codigo, requerimiento: nombre_requerimiento, tipo, consideraciones, lineamientos, lineamientoIds, relacionados };
  return { req, tipo, ctx, buildArgs, dryMeta: { consideraciones, lineamientoIds } };
}
