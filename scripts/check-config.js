import { config, publicConfig } from '../src/config/runtime.js';
console.log(JSON.stringify({ parameters:publicConfig(), keyConfigured:Boolean(process.env.OPENAI_API_KEY), mysql:{host:config.mysql.host,port:config.mysql.port,database:config.mysql.database,user:config.mysql.user,passwordConfigured:Boolean(config.mysql.password)} },null,2));
