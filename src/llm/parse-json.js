export function parseLlmJsonObject(rawText) {
  if (typeof rawText !== 'string' || rawText.trim() === '') {
    throw new Error('parseLlmJsonObject: respuesta vacía del LLM.');
  }

  let text = rawText.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  const candidate =
    firstBrace !== -1 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text;

  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed[0] ?? {};
    return parsed;
  } catch (err) {
    throw new Error(
      `parseLlmJsonObject: no se pudo parsear JSON. Detalle: ${err.message}\n--- Texto recibido (primeros 500 chars) ---\n${text.slice(0, 500)}`
    );
  }
}

export function parseLlmJson(rawText) {
  if (typeof rawText !== 'string' || rawText.trim() === '') {
    throw new Error('parseLlmJson: respuesta vacía del LLM.');
  }

  let text = rawText.trim();

  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  let candidate = text;
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidate = text.slice(firstBracket, lastBracket + 1);
  } else if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidate = `[${text.slice(firstBrace, lastBrace + 1)}]`;
  }

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    throw new Error(
      `parseLlmJson: no se pudo parsear JSON. Detalle: ${err.message}\n--- Texto recibido (primeros 500 chars) ---\n${text.slice(0, 500)}`
    );
  }
}
