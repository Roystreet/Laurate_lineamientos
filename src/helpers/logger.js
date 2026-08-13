import chalk from 'chalk';

function ts() {
  return new Date().toISOString();
}

export const logger = {
  info: (msg) => console.log(`${chalk.gray(ts())} ${chalk.blue('INFO ')} ${msg}`),
  ok: (msg) => console.log(`${chalk.gray(ts())} ${chalk.green('OK   ')} ${msg}`),
  warn: (msg) => console.warn(`${chalk.gray(ts())} ${chalk.yellow('WARN ')} ${msg}`),
  error: (msg) => console.error(`${chalk.gray(ts())} ${chalk.red('ERROR')} ${msg}`),
  step: (name) => console.log(`\n${chalk.magenta.bold('▶ ' + name)}\n`),
};
