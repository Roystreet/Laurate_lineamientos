import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './paths.js';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export function loadConfig(env = process.env) {
  const str = (key, fallback) => String(env[key] ?? fallback).trim();
  const num = (key, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key}: entero entre ${min} y ${max} requerido.`);
    return value;
  };
  const choice = (key, fallback, values) => {
    const value = str(key, fallback);
    if (!values.includes(value)) throw new Error(`${key}: valores permitidos ${values.join(', ')}.`);
    return value;
  };
  const efforts = ['none', 'low', 'medium', 'high', 'xhigh'];
  return Object.freeze({
    fichaModel: str('FICHA_MODEL', 'gpt-5.4'), fichaEffort: choice('FICHA_REASONING_EFFORT', 'high', efforts),
    analysisModel: str('ANALISIS_MODEL', 'gpt-5.4-mini'), analysisEffort: choice('ANALISIS_REASONING_EFFORT', 'medium', efforts),
    ocrModel: str('OCR_MODEL', 'gpt-5.4-mini'), ocrEffort: choice('OCR_REASONING_EFFORT', 'medium', efforts),
    suggestionModel: str('SUGERENCIA_MODEL', 'gpt-5.4'), suggestionEffort: choice('SUGERENCIA_REASONING_EFFORT', 'medium', efforts),
    ocrMode: choice('OCR_MODE', 'auto', ['auto', 'always', 'off']),
    ocrDetail: choice('OCR_IMAGE_DETAIL', 'original', ['auto', 'low', 'high', 'original']),
    ocrDpi: num('OCR_DPI', 200, 72, 600), ocrMinChars: num('OCR_MIN_TEXT_CHARS', 40, 0),
    timeoutMs: num('OPENAI_TIMEOUT_MS', 900000), maxAttempts: num('OPENAI_MAX_ATTEMPTS', 3, 1, 10),
    uploadMb: num('UPLOAD_MAX_FILE_MB', 50, 1, 500), uploadFiles: num('UPLOAD_MAX_FILES', 20, 1, 100),
    port: num('API_PORT', 8008, 1, 65535), host: str('API_HOST', '127.0.0.1'),
    storageRoot: path.resolve(ROOT, str('STORAGE_DIR', 'storage')),
    mysql: Object.freeze({ host: str('MYSQL_HOST', '127.0.0.1'), port: num('MYSQL_PORT', 3307, 1, 65535),
      database: str('MYSQL_DATABASE', 'laureate_lineamientos'), user: str('MYSQL_USER', 'laureate'), password: str('MYSQL_PASSWORD', '') }),
  });
}

export const config = loadConfig();
export function publicConfig(value = config) {
  const { mysql, storageRoot, host, port, ...safe } = value;
  return safe;
}
