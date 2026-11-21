const { spawn } = require('child_process');
const path = require('path');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const isRunningAsRoot =
  typeof process.geteuid === 'function'
    ? process.geteuid() === 0
    : typeof process.getuid === 'function' && process.getuid() === 0;

const appRoot = path.resolve(__dirname, '..');
const args = [appRoot];
if (isRunningAsRoot) {
  args.push('--no-sandbox');
}
args.push(...process.argv.slice(2));

const child = spawn(electronBinary, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
