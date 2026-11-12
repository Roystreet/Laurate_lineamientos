import { readFileText } from '../fs.helper.js';

export async function parseJson(file) {
  const raw = await readFileText(file);
  const data = JSON.parse(raw);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const meta = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {};
  return { text, meta, data };
}
