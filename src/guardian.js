import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { childEnv } from './connector.js';

let child, directory, stopping = false, started = false;
const report = status => { if (process.connected) process.send?.({ type: 'status', status }); };
async function stop() {
  if (stopping) return; stopping = true;
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  report('stopped'); if (process.connected) process.disconnect();
}
process.on('disconnect', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); }); process.on('SIGINT', () => { void stop(); });
process.on('message', async message => {
  if (message?.type === 'stop') return void stop();
  if (message?.type !== 'start' || started || stopping) return;
  started = true;
  try {
    directory = await mkdtemp(join(tmpdir(), 'dsh-cf-'));
    const config = join(directory, 'config.yml'); await writeFile(config, '{}\n', { mode: 0o600 });
    if (stopping) { await rm(directory, { recursive: true, force: true }); return; }
    child = spawn(message.binary, ['--no-autoupdate', 'tunnel', '--config', config, '--metrics', '127.0.0.1:0', '--logformat', 'json', 'run', '--token-file', message.tokenFile], { shell: false, windowsHide: true, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    report('starting'); let buffer = '';
    const parse = chunk => {
      buffer = (buffer + chunk.toString()).slice(-32_768);
      for (;;) {
        const n = buffer.indexOf('\n'); if (n < 0) break;
        const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        // Only a bounded status enum crosses IPC. Raw cloudflared logs can contain credentials.
        const text = String(event.message || '');
        if (text.includes('Registered tunnel connection')) report('connected');
        else if (text.includes('Unregistered tunnel connection') || text.includes('Retrying connection')) report('disconnected');
      }
    };
    child.stdout.on('data', parse); child.stderr.on('data', parse);
    child.on('error', () => { report('error'); void stop(); });
    child.once('exit', () => { if (!stopping) { report('error'); void stop(); } });
  } catch { report('error'); await stop(); }
});
