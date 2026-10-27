import { spawn } from 'node:child_process';
import { once } from 'node:events';

/** Launch URLs in a failed command's output must not keep their token. */
export function scrubLaunchToken(text) {
  return String(text).replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
}

/**
 * Run a command. Success returns stdout only, so a JSON command can be parsed
 * when npm also writes a warning to stderr. The warning is copied to this
 * process's stderr and is not discarded. A non-zero exit throws with both
 * streams in the message.
 */
export async function runCommand(bin, args, { cwd, env = process.env, timeoutMs = 240_000 } = {}) {
  const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  try {
    const [code] = await once(child, 'exit');
    if (code !== 0) {
      const diagnostic = scrubLaunchToken([stderr, stdout].filter(Boolean).join('\n')).slice(-3000);
      throw Object.assign(new Error(diagnostic || `command exited ${code}`), { code, stdout, stderr });
    }
    if (stderr) process.stderr.write(stderr);
    return stdout;
  } finally { clearTimeout(timer); }
}
