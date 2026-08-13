#!/usr/bin/env node
import { logger } from './helpers/logger.js';
import { runStep0 } from './steps/0-convertir-a-markdown/index.js';
import { runStep1 } from './steps/1-validar-requerimientos/index.js';
import { runStep2 } from './steps/2-procesar-requerimiento/index.js';
import { runStep3 } from './steps/3-generar-excel-por-requerimiento/index.js';
import { runStep4 } from './steps/4-generar-matriz-total-lineamientos/index.js';
import { runStep5 } from './steps/5-consolidar-hallazgos/index.js';
import { runGenerarJsonRequerimientos } from './steps/generar-json-requerimientos/index.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (const a of rest) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? true;
    }
  }
  return { command, flags };
}

const STEPS = {
  'step:0': runStep0,
  'step:1': runStep1,
  'step:2': runStep2,
  'step:3': runStep3,
  'step:4': runStep4,
  'step:5': runStep5,
};

const COMMANDS = {
  'generate:formato_json_ficha_requerimientos': runGenerarJsonRequerimientos,
};

async function runPipeline(flags) {
  logger.step('PIPELINE COMPLETO');
  await runStep0(flags);
  await runGenerarJsonRequerimientos(flags);
  await runStep1(flags);
  await runStep2(flags);
  await runStep3(flags);
  await runStep4(flags);
  await runStep5(flags);
  logger.ok('Pipeline finalizada.');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command) {
    console.log(
      'Uso: node src/index.js <step:0|step:1|step:2|step:3|step:4|step:5|pipeline|generate:formato_json_ficha_requerimientos> [--flags]'
    );
    process.exit(1);
  }

  try {
    if (command === 'pipeline') {
      await runPipeline(flags);
      return;
    }
    const fn = STEPS[command] || COMMANDS[command];
    if (!fn) {
      logger.error(`Comando desconocido: ${command}`);
      process.exit(1);
    }
    await fn(flags);
  } catch (err) {
    logger.error(err?.stack || err?.message || String(err));
    process.exit(1);
  }
}

main();
