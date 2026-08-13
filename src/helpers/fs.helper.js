import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readFileBuffer(file) {
  return fs.readFile(file);
}

export async function readFileText(file, encoding = 'utf8') {
  return fs.readFile(file, encoding);
}

export async function writeFileText(file, content) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, content, 'utf8');
}

export async function cleanDir(dir) {
  if (await pathExists(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await ensureDir(dir);
}

export async function listFiles(dir, patterns = ['**/*']) {
  if (!(await pathExists(dir))) return [];
  return fg(patterns, { cwd: dir, absolute: true, onlyFiles: true, dot: false });
}

export async function listDirs(dir) {
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
}

export function existsSync(p) {
  return fss.existsSync(p);
}

export function extOf(file) {
  return path.extname(file).toLowerCase();
}
