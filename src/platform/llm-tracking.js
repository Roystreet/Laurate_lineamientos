import { randomUUID } from 'node:crypto';
import { query, transaction } from './db.js';
import { assertLease } from './queue.js';
import { config } from '../config/runtime.js';
import { digest } from './storage.js';

/** Registra cada llamada al modelo en `llamadas_llm` bajo la reserva de la tarea. */
export function trackedLlm(task, stage, llm, settings = config) {
  return async (args) => {
    const id = randomUUID(), start = Date.now();
    const messages = { system:args.system, user:args.user,
      images:(args.images ?? []).map((i)=>({sha256:digest(i.url),detail:i.detail})) };
    await transaction(async(c)=>{
      await assertLease(task,c);
      await query('INSERT INTO llamadas_llm(id,tarea_id,etapa,modelo,mensajes) VALUES (?,?,?,?,?)',[id,task.id,stage,args.model,JSON.stringify(messages)],c);
    });
    try {
      const response=await llm({...args,timeoutMs:settings.timeoutMs,maxAttempts:settings.maxAttempts});
      await query('UPDATE llamadas_llm SET respuesta=?,uso=?,duracion_ms=? WHERE id=?',[response.rawText,JSON.stringify(response.usage ?? null),Date.now()-start,id]);
      return response;
    } catch(error) {
      await query('UPDATE llamadas_llm SET error=?,duracion_ms=? WHERE id=?',[error.message,Date.now()-start,id]);
      throw error;
    }
  };
}
