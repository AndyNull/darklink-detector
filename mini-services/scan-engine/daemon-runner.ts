import { spawn } from 'child_process';
import { createServer } from 'http';

// Simple healthcheck server on port 3004 that also keeps process alive
const healthServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('daemon-runner alive');
});
healthServer.listen(3004, () => {
  console.log('Daemon runner health server on port 3004');
});

// Start the actual scan engine
const child = spawn('bun', ['index.ts'], {
  cwd: import.meta.dir,
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('Failed to start scan engine:', err);
});

child.on('exit', (code, signal) => {
  console.error(`Scan engine exited with code ${code}, signal ${signal}`);
  // Restart
  setTimeout(() => {
    console.log('Restarting scan engine...');
    spawn('bun', ['index.ts'], { cwd: import.meta.dir, stdio: 'inherit' });
  }, 3000);
});

// Keep alive
setInterval(() => {}, 30000);
