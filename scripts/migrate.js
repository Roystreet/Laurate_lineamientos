import { migrate, pool } from '../src/platform/db.js';
try { await migrate();console.log('Esquema MySQL listo.'); }
catch(error){console.error(`No se pudo preparar MySQL: ${error.code ?? 'error de conexión'}`);process.exitCode=1;}
finally { await pool.end(); }
