import { pathToFileURL } from 'node:url';
import { pool, query } from './db.js';
import { claim, heartbeat, settle } from './queue.js';
import { processTask } from './processor.js';

export async function runWorker({signal}={}) {
  while(!signal?.aborted){
    const task=await claim();
    if(!task){ await new Promise(r=>setTimeout(r,1000));continue; }
    const timer=setInterval(()=>heartbeat(task).catch(()=>{}),10000);
    try{await processTask(task);await settle(task);}
    catch(error){
      console.error(`Tarea ${task.id}: ${error.message}`);
      const settled=await settle(task,error.message);
      if(settled.affectedRows && task.ejecucion_id && task.tipo==='reports') await query("UPDATE ejecuciones SET estado='error',error=? WHERE id=?",[error.message,task.ejecucion_id]);
    }finally{clearInterval(timer);}
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const controller=new AbortController();
  process.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());
  runWorker({signal:controller.signal}).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
}
