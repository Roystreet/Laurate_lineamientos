import { readFileText } from '../fs.helper.js';

export async function parseTxt(file) {
  const text = await readFileText(file);
  return { text, meta: {} };
}
