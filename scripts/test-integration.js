import mysql from 'mysql2/promise';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../src/config/runtime.js';
const database=`laureate_test_${randomUUID().replaceAll('-','')}`;
const storage=await fs.mkdtemp(path.join(os.tmpdir(),'laureate-integration-'));
const root=await mysql.createConnection({...config.mysql,database:undefined,user:'root',password:process.env.MYSQL_ROOT_PASSWORD});
try {
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
  await root.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${root.escape(config.mysql.user)}@'%'`);
  const file=process.argv.includes('--openai')?'tests/integration/openai-smoke.js':'tests/integration/platform.test.js';
  const child=spawn(process.execPath,file.endsWith('.test.js')?['--test',file]:[file],{stdio:'inherit',env:{...process.env,MYSQL_DATABASE:database,STORAGE_DIR:storage}});
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code ?? 1)));
}finally{
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);await root.end();await fs.rm(storage,{recursive:true,force:true});
}
