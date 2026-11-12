import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config/runtime.js';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function storagePath(...parts) {
  const result = path.resolve(config.storageRoot, ...parts);
  if (result !== config.storageRoot && !result.startsWith(config.storageRoot + path.sep)) throw new Error('Ruta de almacenamiento inválida.');
  return result;
}
export async function fileHash(file) { return digest(await fs.readFile(file)); }
export function storageKey(file) { return path.relative(config.storageRoot, storagePath(file)); }
export function safeCode(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,5}$/.test(value)) throw Object.assign(new Error('El código debe tener formato numérico, por ejemplo 5.3.1.14.'), { statusCode: 400 });
  return value;
}
export function safeLineamiento(value) {
  const text = String(value).normalize('NFC').trim();
  if (!text || text.length > 180 || /[\\/|\x00-\x1f]/.test(text) || text === '.' || text === '..') throw Object.assign(new Error('Identificador de evidencia inválido.'), { statusCode: 400 });
  return text;
}
