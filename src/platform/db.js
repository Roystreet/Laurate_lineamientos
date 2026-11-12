import mysql from 'mysql2/promise';
import { config } from '../config/runtime.js';

export const pool = mysql.createPool({ ...config.mysql, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 10, decimalNumbers: true });
export const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
export async function query(sql, values = [], connection = pool) {
  const [rows] = await connection.execute(sql, values);
  return rows;
}
export async function transaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const value = await fn(connection);
    await connection.commit();
    return value;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function migrate() {
  const { default: fs } = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(statement);
  const columns=await query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=\'requerimientos\' AND COLUMN_NAME=\'documento_ficha_actual\'',[config.mysql.database]);
  if(!columns.length) await pool.query('ALTER TABLE requerimientos ADD COLUMN documento_ficha_actual CHAR(36)');
  const versionColumns=await query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='versiones_documento' AND COLUMN_NAME='nombre_original'",[config.mysql.database]);
  if(!versionColumns.length) await pool.query('ALTER TABLE versiones_documento ADD COLUMN nombre_original VARCHAR(255)');
  await pool.query('UPDATE versiones_documento v JOIN documentos d ON d.id=v.documento_id SET v.nombre_original=d.nombre_original WHERE v.nombre_original IS NULL');
  await pool.query("UPDATE requerimientos r SET documento_ficha_actual=(SELECT d.id FROM documentos d WHERE d.requerimiento_id=r.id AND d.clase='ficha' ORDER BY d.created_at DESC,d.id DESC LIMIT 1) WHERE documento_ficha_actual IS NULL");
}
