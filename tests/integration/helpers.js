import { randomUUID } from 'node:crypto';
import { claim, settle } from '../../src/platform/queue.js';
import { processTask } from '../../src/platform/processor.js';

export const condition = 'La política debe indicar responsables.';

/** Fake LLM: ficha, OCR and the six criteria. With a Config IA rule in the system prompt, C2–C6 report a finding. */
export function fakeLlm(calls = []) {
  return async (args) => {
    calls.push(args);
    if (args.system.includes('Extractor de Datos Normativos')) return { rawText: JSON.stringify({ nombre_requerimiento: 'Requerimiento de prueba', tipo: 'lineamiento', consideraciones: [condition], requerimientos_relacionados: [] }) };
    if (args.system.includes('Transcribe fielmente')) return { rawText: JSON.stringify({ text: 'Texto', blank: false, illegible: false }) };
    const criterion = args.system.match(/CRITERIO A EVALUAR: ([^\n]+)/)?.[1];
    if (criterion === 'Información completa') return { rawText: JSON.stringify({ consideraciones: [{ consideracion: condition, por_lineamiento: [{ lineamiento: 'politica', cumple: 'si', literal: 'Responsable: Dirección', observacion: 'Indica responsable.' }] }], hallazgos_generales: [] }) };
    const withRule = args.system.includes('- [R-');
    return { rawText: JSON.stringify([{ criterio: criterion, estado: withRule ? 'No cumple' : 'Cumple', tipo_hallazgo: withRule ? 'Observación' : 'Cumple', literal: 'Responsable: Dirección', observacion: withRule ? 'Aplicó la regla.' : 'Documento consistente.', razonamiento_previo: 'Análisis del conjunto.', hallazgo: withRule ? 'Con regla' : 'N/A', lineamiento_afectado: 'politica', integracion: '', requerimientos_relacionados: [] }]) };
  };
}

export async function drain(llm) {
  let task;
  while ((task = await claim())) {
    try { await processTask(task, { llm }); await settle(task); } catch (error) { await settle(task, error.message); }
  }
}

function multipart(fields, name, content) {
  const boundary = 'laureate-' + randomUUID();
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(content), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Uploads a ficha and one text evidence for `code`, prepares them (does not analyze). */
export async function seedPrepared(app, code, llm) {
  let response = await app.inject({ method: 'POST', url: '/api/uploads', ...multipart({ kind: 'ficha', code }, 'ficha.txt', `Ficha ${code}. CONSIDERACIONES DEL REQUERIMIENTO: ${condition}`) });
  if (response.statusCode !== 202) throw new Error(response.body);
  const reqId = response.json().files[0].requirementId;
  await drain(llm);
  response = await app.inject({ method: 'POST', url: '/api/uploads', ...multipart({ kind: 'evidencia', reqId }, 'politica.txt', 'Política institucional\nResponsable: Dirección') });
  if (response.statusCode !== 202) throw new Error(response.body);
  await drain(llm);
  return reqId;
}

/** Prepares and analyzes `code`; returns the requirement and run ids. */
export async function seedAnalyzed(app, code, llm) {
  const reqId = await seedPrepared(app, code, llm);
  const response = await app.inject({ method: 'POST', url: '/api/runs', payload: { requirementIds: [reqId] } });
  if (response.statusCode !== 202) throw new Error(response.body);
  const runId = response.json().id;
  await drain(llm);
  return { reqId, runId };
}
