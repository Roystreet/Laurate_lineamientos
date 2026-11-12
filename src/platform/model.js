import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query, transaction, json } from './db.js';
import { enqueue } from './queue.js';
import { config, publicConfig } from '../config/runtime.js';
import { storagePath, storageKey, safeCode, safeLineamiento, digest } from './storage.js';
import { ROOT } from '../config/paths.js';
import { production } from './config-ia/versions.js';

export async function requirements() {
  const rows = await query(`SELECT r.*,v.ficha,
    (SELECT COUNT(*) FROM requerimiento_evidencias e WHERE e.requerimiento_id=r.id AND e.activa=1) evidencias,
    (SELECT COUNT(*) FROM documentos d JOIN versiones_documento vd ON vd.id=d.version_actual WHERE d.id=r.documento_ficha_actual AND vd.estado<>'complete') fichas_pendientes,
    (SELECT COUNT(*) FROM requerimiento_evidencias e JOIN documentos d ON d.id=e.documento_id JOIN versiones_documento vd ON vd.id=d.version_actual WHERE e.requerimiento_id=r.id AND e.activa=1 AND vd.estado<>'complete') evidencias_pendientes
    FROM requerimientos r LEFT JOIN versiones_requerimiento v ON v.id=r.version_actual ORDER BY r.codigo`);
  return rows.map((r) => ({ ...r, ficha: r.ficha ? json(r.ficha) : null })).sort((a,b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
}
export async function documents(reqId) {
  return query(`SELECT d.id,d.clase,d.nombre_original,d.requerimiento_id,d.version_actual,v.estado,v.force_ocr,v.error,v.created_at,
    e.lineamiento,e.activa,(d.requerimiento_id<>?) compartido,(SELECT COUNT(*) FROM paginas_documento p WHERE p.documento_version_id=v.id AND p.metodo='ocr') paginas_ocr
    FROM documentos d JOIN versiones_documento v ON v.id=d.version_actual
    LEFT JOIN requerimiento_evidencias e ON e.documento_id=d.id AND e.requerimiento_id=?
    WHERE (d.clase='ficha' AND d.requerimiento_id=?) OR e.id IS NOT NULL ORDER BY d.created_at,d.id`, [reqId,reqId,reqId]);
}
export async function evidenceLibrary() {
  return query(`SELECT d.id,d.nombre_original,r.codigo,e.lineamiento FROM documentos d
    JOIN requerimientos r ON r.id=d.requerimiento_id JOIN versiones_documento v ON v.id=d.version_actual
    JOIN requerimiento_evidencias e ON e.documento_id=d.id AND e.requerimiento_id=d.requerimiento_id
    WHERE d.clase='evidencia' AND v.estado='complete' ORDER BY d.nombre_original,d.id`);
}
export async function associateEvidence(reqId,docId,lineamiento) {
  if(typeof docId!=='string'||!docId) throw Object.assign(new Error('Selecciona un documento existente.'),{statusCode:400});
  return transaction(async(c)=>{
    await query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE',[],c);
    const [req]=await query('SELECT id FROM requerimientos WHERE id=?',[reqId],c);
    const [doc]=await query("SELECT d.id,d.nombre_original,v.estado FROM documentos d JOIN versiones_documento v ON v.id=d.version_actual WHERE d.id=? AND d.clase='evidencia'",[docId],c);
    if(!req||!doc) throw Object.assign(new Error('Selecciona un requerimiento y una evidencia existentes.'),{statusCode:404});
    if(doc.estado!=='complete') throw Object.assign(new Error('Espera a que el documento esté preparado.'),{statusCode:409});
    const key=safeLineamiento(lineamiento ?? path.basename(doc.nombre_original,path.extname(doc.nombre_original)));
    const [existing]=await query('SELECT * FROM requerimiento_evidencias WHERE requerimiento_id=? AND documento_id=?',[reqId,docId],c);
    if(existing?.activa) throw Object.assign(new Error('Este documento ya está relacionado con el requerimiento.'),{statusCode:409});
    const [duplicate]=await query('SELECT id FROM requerimiento_evidencias WHERE requerimiento_id=? AND lineamiento=? AND documento_id<>?',[reqId,key,docId],c);
    if(duplicate) throw Object.assign(new Error('Ese ID de lineamiento ya está usado en este requerimiento. Elige otro.'),{statusCode:409});
    if(existing) await query('UPDATE requerimiento_evidencias SET activa=1,lineamiento=? WHERE id=?',[key,existing.id],c);
    else await query('INSERT INTO requerimiento_evidencias(id,requerimiento_id,documento_id,lineamiento) VALUES (?,?,?,?)',[randomUUID(),reqId,docId,key],c);
    return {documentId:docId,requirementId:reqId,lineamiento:key};
  });
}
export async function findRequirement(code, c) {
  safeCode(code);
  const rows = await query('SELECT * FROM requerimientos WHERE codigo=?', [code], c);
  if (rows.length) return rows[0];
  const id = randomUUID();
  await query('INSERT INTO requerimientos(id,codigo) VALUES (?,?)', [id,code], c);
  return { id, codigo: code };
}
export async function registerUpload({ code, reqId, kind, name, file, hash, lineamiento, replaceId }) {
  if (!['ficha', 'evidencia'].includes(kind)) throw Object.assign(new Error('Clase de documento inválida.'), { statusCode: 400 });
  return transaction(async (c) => {
    let req;
    if (kind === 'ficha') req = await findRequirement(code, c);
    else {
      [req] = await query('SELECT * FROM requerimientos WHERE id=?', [reqId ?? ''], c);
      if (!req) throw Object.assign(new Error('Selecciona un requerimiento existente.'), { statusCode: 400 });
    }
    const id = replaceId ?? randomUUID(), versionId = randomUUID();
    if (replaceId) {
      const old = await query('SELECT * FROM documentos WHERE id=? AND requerimiento_id=? AND clase=?', [id,req.id,kind], c);
      if (!old.length) throw Object.assign(new Error('Documento a reemplazar no encontrado.'), { statusCode: 404 });
    } else {
      await query('INSERT INTO documentos(id,requerimiento_id,clase,nombre_original) VALUES (?,?,?,?)', [id,req.id,kind,name], c);
      if (kind === 'evidencia') {
        const key = safeLineamiento(lineamiento ?? path.basename(name, path.extname(name)));
        const found = await query('SELECT id FROM requerimiento_evidencias WHERE requerimiento_id=? AND lineamiento=?', [req.id,key], c);
        if (found.length) throw Object.assign(new Error(`Ya existe la evidencia «${key}». Utiliza Reemplazar o cambia su nombre.`), { statusCode: 409 });
        await query('INSERT INTO requerimiento_evidencias(id,requerimiento_id,documento_id,lineamiento) VALUES (?,?,?,?)', [randomUUID(),req.id,id,key], c);
      }
    }
    await query('INSERT INTO versiones_documento(id,documento_id,nombre_original,original_path,sha256,configuracion) VALUES (?,?,?,?,?,?)', [versionId,id,name,storageKey(file),hash,JSON.stringify(publicConfig())], c);
    await query('UPDATE documentos SET version_actual=?,nombre_original=? WHERE id=?', [versionId,name,id], c);
    if(kind==='ficha') await query('UPDATE requerimientos SET documento_ficha_actual=? WHERE id=?',[id,req.id],c);
    const taskId = await enqueue('prepare', { versionId }, null, 10, c);
    return { documentId: id, versionId, taskId, requirementId: req.id };
  });
}
export async function reprocess(docId, force = true) {
  return transaction(async (c) => {
    const [doc] = await query('SELECT d.*,v.original_path,v.sha256 FROM documentos d JOIN versiones_documento v ON v.id=d.version_actual WHERE d.id=? FOR UPDATE', [docId], c);
    if (!doc) throw Object.assign(new Error('Documento no encontrado.'), { statusCode: 404 });
    if (!/\.(pdf|png|jpe?g)$/i.test(doc.original_path)) throw Object.assign(new Error('OCR solo está disponible para PDF, PNG y JPG.'), { statusCode: 400 });
    const id = randomUUID();
    await query('INSERT INTO versiones_documento(id,documento_id,nombre_original,original_path,sha256,configuracion,force_ocr) VALUES (?,?,?,?,?,?,?)', [id,docId,doc.nombre_original,doc.original_path,doc.sha256,JSON.stringify(publicConfig()),force], c);
    await query('UPDATE documentos SET version_actual=? WHERE id=?', [id,docId], c);
    return { versionId: id, taskId: await enqueue('prepare', { versionId: id }, null, 10, c) };
  });
}
export async function detach(docId, active, reqId) {
  // Older clients omit reqId; scope those requests to the original association.
  const result = await query('UPDATE requerimiento_evidencias SET activa=? WHERE documento_id=? AND requerimiento_id=COALESCE(?,(SELECT requerimiento_id FROM documentos WHERE id=?))', [active,docId,reqId ?? null,docId]);
  if (!result.affectedRows) throw Object.assign(new Error('Evidencia no encontrada.'), { statusCode: 404 });
}
export async function engineVersion(c) {
  const sources = {};
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir,item.name);
      if (item.isDirectory()) await walk(file);
      else if (/\.(js|sql)$/.test(item.name)) sources[path.relative(ROOT,file)] = await fs.readFile(file,'utf8');
    }
  }
  // Include parsers, OCR and exporters as well as the immutable analysis prompts.
  await walk(path.join(ROOT,'src'));
  const content = { sources, configuration: publicConfig() }, hash = digest(JSON.stringify(content));
  const id = randomUUID();
  await query('INSERT IGNORE INTO versiones_motor(id,sha256,contenido) VALUES (?,?,?)',[id,hash,JSON.stringify(content)],c);
  const [record] = await query('SELECT id FROM versiones_motor WHERE sha256=?',[hash],c);
  return record.id;
}
export async function startRun(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw Object.assign(new Error('Selecciona entre 1 y 10 requerimientos distintos.'), { statusCode: 400 });
  return transaction(async (c) => {
    await query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE', [], c);
    const active = await query("SELECT id FROM ejecuciones WHERE estado IN ('queued','running') LIMIT 1", [], c);
    if (active.length) throw Object.assign(new Error('Hay un análisis en curso. Espera a que termine.'), { statusCode: 409 });
    const catalog = await query('SELECT r.id,r.codigo,r.version_actual,v.ficha FROM requerimientos r JOIN versiones_requerimiento v ON v.id=r.version_actual', [], c);
    const selected = catalog.filter((r) => ids.includes(r.id)).sort((a,b) => a.codigo.localeCompare(b.codigo,undefined,{numeric:true}));
    if (selected.length !== ids.length) throw Object.assign(new Error('Todos los requerimientos deben tener una ficha preparada.'), { statusCode: 400 });
    const inputs = [];
    for (const req of selected) {
      const pending = await query("SELECT d.id FROM requerimientos r JOIN documentos d ON d.id=r.documento_ficha_actual JOIN versiones_documento v ON v.id=d.version_actual WHERE r.id=? AND v.estado<>'complete'", [req.id], c);
      if (pending.length) throw Object.assign(new Error(`${req.codigo}: espera a que se prepare la ficha.`), { statusCode: 400 });
      const docs = await query(`SELECT e.lineamiento,d.id,d.nombre_original,d.requerimiento_id origen_id,v.id version_id,v.estado,v.markdown,v.metadata FROM requerimiento_evidencias e JOIN documentos d ON d.id=e.documento_id JOIN versiones_documento v ON v.id=d.version_actual WHERE e.requerimiento_id=? AND e.activa=1 ORDER BY e.lineamiento`,[req.id],c);
      if (!docs.length || docs.some((d) => d.estado !== 'complete')) throw Object.assign(new Error(`${req.codigo}: carga evidencias y espera a que estén preparadas.`), { statusCode: 400 });
      for(const doc of docs){
        const rawId=doc.markdown.match(/^id:\s*(.*)$/m)?.[1],storedId=rawId?.startsWith('"')?JSON.parse(rawId):rawId;
        if(doc.origen_id===req.id&&storedId===doc.lineamiento)continue;
        // Preserve text, timestamps and source authority; only retarget the association's labels.
        doc.markdown=doc.markdown.replace(/^requerimiento:.*$/m,`requerimiento: ${req.codigo}`)
          .replace(/^id:.*$/m,`id: ${JSON.stringify(doc.lineamiento)}`)
          .replace(/^# Lineamiento [^\n]*?( — [^\n]*)?$/m,(_,title='')=>`# Lineamiento ${doc.lineamiento} (req ${req.codigo})${title}`);
      }
      inputs.push({ id:req.id, codigo:req.codigo, version:req.version_actual, ficha:json(req.ficha), evidencias:docs });
    }
    const id=randomUUID(), snapshot={ requirements:inputs, catalog:catalog.map((r)=>({...r,ficha:json(r.ficha)})) };
    await query('INSERT INTO ejecuciones(id,configuracion,motor_id,snapshot,reglas_version_id) VALUES (?,?,?,?,?)',[id,JSON.stringify(publicConfig()),await engineVersion(c),JSON.stringify(snapshot),(await production(c)).id],c);
    for (let i=0;i<inputs.length;i++) {
      const req=inputs[i];
      await query('INSERT INTO entradas_ejecucion(ejecucion_id,requerimiento_id,orden,version_requerimiento_id,evidencia) VALUES (?,?,?,?,?)',[id,req.id,i,req.version,JSON.stringify(req.evidencias)],c);
      await enqueue('analyze',{ requirementId:req.id },id,20,c);
    }
    await enqueue('reports',{},id,30,c);
    return { id };
  });
}
export async function runs() {
  const rows=await query(`SELECT e.id,e.estado,e.error,e.created_at,e.finished_at,(SELECT v.numero FROM ia_versiones v WHERE v.id=e.reglas_version_id) reglas_version,
    (SELECT JSON_ARRAYAGG(i.requerimiento_id) FROM entradas_ejecucion i WHERE i.ejecucion_id=e.id) requirementIds,
    (SELECT COUNT(*) FROM entradas_ejecucion i WHERE i.ejecucion_id=e.id) requerimientos,
    (SELECT COUNT(*) FROM resultados_criterio r WHERE r.ejecucion_id=e.id) criterios,
    (SELECT COUNT(*) FROM resultados_criterio r WHERE r.ejecucion_id=e.id AND r.estado_tecnico='error') errores
    FROM ejecuciones e ORDER BY e.created_at DESC LIMIT 100`);
  return rows.map(r=>({...r,requirementIds:json(r.requirementIds) ?? []}));
}
export async function runDetail(id) {
  const [run] = await query('SELECT e.id,e.estado,e.error,e.configuracion,e.snapshot,e.created_at,e.finished_at,v.numero reglas_version FROM ejecuciones e LEFT JOIN ia_versiones v ON v.id=e.reglas_version_id WHERE e.id=?',[id]);
  if (!run) throw Object.assign(new Error('Análisis no encontrado.'),{statusCode:404});
  const [tasks,results,reports] = await Promise.all([
    query('SELECT id,tipo,estado,intentos,error,payload FROM tareas_procesamiento WHERE ejecucion_id=? ORDER BY prioridad,created_at,id',[id]),
    query('SELECT r.*,q.codigo FROM resultados_criterio r JOIN requerimientos q ON q.id=r.requerimiento_id WHERE ejecucion_id=? ORDER BY criterio_id',[id]),
    query('SELECT id,tipo,nombre FROM reportes WHERE ejecucion_id=? ORDER BY tipo,nombre',[id]),
  ]);
  const {snapshot,...safeRun}=run;
  const inputs=json(snapshot).requirements.map(r=>({id:r.id,codigo:r.codigo,ficha:r.ficha,evidencias:r.evidencias.map(d=>({id:d.id,version_id:d.version_id,lineamiento:d.lineamiento,nombre_original:d.nombre_original}))}));
  return {...safeRun,inputs,configuracion:json(run.configuracion),tasks:tasks.map(t=>({...t,payload:json(t.payload)})),results:results.map(r=>({...r,filas:json(r.filas)})),reports};
}
export async function retryTask(id) {
  return transaction(async(c)=>{
    await query('SELECT id FROM coordinacion WHERE id=1 FOR UPDATE',[],c);
    const [task]=await query('SELECT * FROM tareas_procesamiento WHERE id=? FOR UPDATE',[id],c);
    if(!task) throw Object.assign(new Error('Tarea no encontrada.'),{statusCode:404});
    const hasError=task.tipo==='analyze' && (await query("SELECT id FROM resultados_criterio WHERE ejecucion_id=? AND requerimiento_id=? AND estado_tecnico='error'",[task.ejecucion_id,json(task.payload).requirementId],c)).length;
    if(task.estado!=='error' && !hasError) throw Object.assign(new Error('Solo se pueden reintentar tareas fallidas.'),{statusCode:409});
    if(task.ejecucion_id){
      const other=await query("SELECT id FROM ejecuciones WHERE estado IN ('queued','running') AND id<>?",[task.ejecucion_id],c);
      if(other.length) throw Object.assign(new Error('Hay otro análisis en curso.'),{statusCode:409});
      await query("UPDATE ejecuciones SET estado='queued',error=NULL,finished_at=NULL WHERE id=?",[task.ejecucion_id],c);
      await query("UPDATE tareas_procesamiento SET estado='queued',error=NULL,lease_owner=NULL,lease_until=NULL,finished_at=NULL WHERE ejecucion_id=? AND tipo='reports'",[task.ejecucion_id],c);
    }
    await query("UPDATE tareas_procesamiento SET estado='queued',error=NULL,lease_owner=NULL,lease_until=NULL,finished_at=NULL WHERE id=?",[id],c);
    return {id};
  });
}
