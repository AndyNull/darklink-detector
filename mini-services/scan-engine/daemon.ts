// Daemon wrapper that keeps the scan engine alive
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

const logStream = createWriteStream('/tmp/scan-engine-daemon.log', { flags: 'a' });

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  logStream.write(line);
  process.stdout.write(line);
}

function startEngine(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['index.ts'], {
      cwd: '/home/z/my-project/mini-services/scan-engine',
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    child.stdout?.on('data', (data: Buffer) => {
      log(`[OUT] ${data.toString().trim()}`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      log(`[ERR] ${data.toString().trim()}`);
    });

    child.on('exit', (code) => {
      log(`Engine exited with code ${code}`);
      resolve(code || 0);
    });

    child.on('error', (err) => {
      log(`Engine error: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  log('Daemon starting...');
  
  while (true) {
    try {
      const code = await startEngine();
      log(`Engine exited (${code}), restarting in 3 seconds...`);
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      log(`Daemon error: ${err}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main();

process.on('SIGTERM', () => {
  log('Daemon received SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  log('Daemon received SIGINT');
  process.exit(0);
});
