import { config } from '../config/runtime.js';
import OpenAI from 'openai';

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Falta OPENAI_API_KEY. Defínelo en .env (ver .env.example) y ejecuta los scripts con node --env-file=.env.'
    );
  }
  _client = new OpenAI({ apiKey, timeout: config.timeoutMs, maxRetries: 0 });
  return _client;
}

const MODELS_SIN_TEMPERATURE = /^(gpt-5|o\d)/i;

const TRANSIENT_RE = /(connection error|timeout|timed out|ECONNRESET|ETIMEDOUT|socket hang up|network|rate limit)/i;
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esTransitorio(err) {
  const status = err?.status ?? err?.response?.status;
  if (status && TRANSIENT_STATUS.has(status)) return true;
  return TRANSIENT_RE.test(err?.message ?? '');
}

/**
 * Crea la respuesta con reintentos ante errores transitorios (conexión, rate limit, 5xx).
 * Usa streaming para mantener viva la conexión en generaciones largas; `finalResponse()`
 * devuelve el mismo objeto Response que `create()`.
 */
async function createWithRetry(client, payload, maxAttempts = config.maxAttempts, timeoutMs = config.timeoutMs) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.responses.stream(payload, { timeout: timeoutMs }).finalResponse();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !esTransitorio(err)) throw err;
      await sleep(2000 * attempt); // backoff: 2s, 4s
    }
  }
  throw lastErr;
}

export async function callOpenAI({
  system,
  user,
  model = config.analysisModel,
  temperature,
  maxOutputTokens,
  reasoningEffort = config.analysisEffort,
  images = [],
  timeoutMs = config.timeoutMs,
  maxAttempts = config.maxAttempts,
} = {}) {
  if (!user) throw new Error('callOpenAI: "user" es requerido.');

  const client = getClient();

  const input = [];
  if (system) {
    input.push({ role: 'system', content: [{ type: 'input_text', text: system }] });
  }
  input.push({ role: 'user', content: [{ type: 'input_text', text: user }, ...images.map((image) => ({ type: 'input_image', image_url: image.url, detail: image.detail ?? config.ocrDetail }))] });

  const payload = { model, input };

  if (temperature !== undefined && !MODELS_SIN_TEMPERATURE.test(model)) {
    payload.temperature = temperature;
  }

  if (/^gpt-5/i.test(model) && reasoningEffort) {
    payload.reasoning = { effort: reasoningEffort };
  }

  if (maxOutputTokens) payload.max_output_tokens = maxOutputTokens;

  const response = await createWithRetry(client, payload, maxAttempts, timeoutMs);

  const rawText =
    response.output_text ??
    response.output
      ?.flatMap((o) => o?.content ?? [])
      ?.map((c) => c?.text?.value ?? c?.text ?? '')
      ?.join('') ??
    '';

  return { rawText, usage: response.usage ?? null, raw: response };
}
