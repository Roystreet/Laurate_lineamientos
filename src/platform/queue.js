import { randomUUID } from 'node:crypto';
import { query, transaction, json } from './db.js';

export async function enqueue(type, payload, runId = null, priority = 10, connection) {
  const id = randomUUID();
  await query('INSERT INTO tareas_procesamiento (id,ejecucion_id,tipo,payload,prioridad) VALUES (?,?,?,?,?)', [id,runId,type,JSON.stringify(payload),priority], connection);
  return id;
}
export async function claim() {
  return transaction(async (c) => {
    await query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE', [], c);
    const busy = await query("SELECT id FROM tareas_procesamiento WHERE estado='running' AND lease_until > NOW(3) LIMIT 1", [], c);
    if (busy.length) return null;
    const tasks = await query("SELECT * FROM tareas_procesamiento WHERE estado='queued' OR (estado='running' AND lease_until < NOW(3)) ORDER BY prioridad,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED", [], c);
    if (!tasks.length) return null;
    const task = tasks[0], owner = randomUUID();
    await query("UPDATE tareas_procesamiento SET estado='running',lease_owner=?,lease_until=DATE_ADD(NOW(3),INTERVAL 60 SECOND),intentos=intentos+1,error=NULL WHERE id=?", [owner, task.id], c);
    return { ...task, payload: json(task.payload), lease_owner: owner };
  });
}
export async function assertLease(task, c) {
  const rows = await query("SELECT id FROM tareas_procesamiento WHERE id=? AND lease_owner=? AND estado='running' AND lease_until>NOW(3) FOR UPDATE", [task.id, task.lease_owner], c);
  if (!rows.length) throw new Error('La reserva del trabajo expiró; otro worker continuará.');
}
export async function heartbeat(task) {
  const value = await query("UPDATE tareas_procesamiento SET lease_until=DATE_ADD(NOW(3),INTERVAL 60 SECOND) WHERE id=? AND lease_owner=? AND estado='running'", [task.id, task.lease_owner]);
  return value.affectedRows === 1;
}
export async function settle(task, error = null) {
  return query('UPDATE tareas_procesamiento SET estado=?,error=?,lease_until=NULL,finished_at=NOW(3) WHERE id=? AND lease_owner=? AND estado=\'running\'', [error ? 'error' : 'done',error,task.id,task.lease_owner]);
}
