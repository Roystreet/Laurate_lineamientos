import * as versions from './versions.js';
import * as requests from './requests.js';
import * as playground from './playground.js';
import * as suggestions from './suggestions.js';
import { callOpenAI } from '../../llm/openai.client.js';

/** Rutas de Config IA bajo /api/config-ia. `llm` llama al modelo que sugiere reglas (inyectable en pruebas). */
export function registerConfigIaRoutes(app, { llm = callOpenAI } = {}) {
  const base = '/api/config-ia';
  app.get(`${base}/versions`, () => versions.listVersions());
  app.get(`${base}/versions/:numero`, (req) => versions.versionByNumero(req.params.numero));
  app.post(`${base}/versions/:numero/republish`, async (req, reply) => reply.code(201).send(await versions.republish(req.params.numero, req.body ?? {})));
  app.get(`${base}/rules`, (req) => versions.listRules(req.query ?? {}));
  app.get(`${base}/rules/:codigo/history`, (req) => versions.ruleHistory(req.params.codigo));
  app.get(`${base}/cases`, (req) => requests.casesFor(req.query?.requirementId));
  app.get(`${base}/requests`, () => requests.listRequests());
  app.post(`${base}/requests`, async (req, reply) => {
    const created = await requests.createRequest(req.body ?? {});
    let sugerenciaId = null;
    // Si la sugerencia no puede iniciarse, la solicitud igual queda creada.
    try { sugerenciaId = (await suggestions.startSuggestion(created.id, { autor: req.body?.autor }, llm)).id; }
    catch (error) { console.error(`Solicitud ${created.numero}: no se pudo iniciar la sugerencia (${error.message})`); }
    return reply.code(201).send({ ...created, sugerenciaId });
  });
  app.get(`${base}/requests/:id`, (req) => requests.requestDetail(req.params.id));
  app.post(`${base}/requests/:id/suggestions`, async (req, reply) => reply.code(202).send({ id: (await suggestions.startSuggestion(req.params.id, req.body ?? {}, llm)).id }));
  app.get(`${base}/requests/:id/suggestion`, async (req) => ({ sugerencia: await suggestions.latestSuggestion(req.params.id) }));
  app.put(`${base}/requests/:id/draft`, (req) => requests.saveDraft(req.params.id, req.body ?? {}));
  app.post(`${base}/requests/:id/reject`, (req) => requests.rejectRequest(req.params.id, req.body ?? {}));
  app.post(`${base}/requests/:id/publish`, async (req, reply) => reply.code(201).send(await requests.publishRequest(req.params.id, req.body ?? {})));
  app.post(`${base}/tests`, async (req, reply) => reply.code(202).send(await playground.createTest(req.body ?? {})));
  app.get(`${base}/tests/:id`, (req) => playground.testDetail(req.params.id));
  app.post(`${base}/tests/:id/verdict`, (req) => playground.recordVerdict(req.params.id, req.body ?? {}));
}
