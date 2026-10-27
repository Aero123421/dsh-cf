import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../scripts/run-command.mjs';

test('a zero exit returns stdout only and still surfaces a stderr warning', async () => {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = chunk => { chunks.push(String(chunk)); return true; };
  try {
    const stdout = await runCommand(process.execPath, ['-e', 'process.stderr.write("npm warn noise\\n"); process.stdout.write("[{\\"filename\\":\\"ok.tgz\\"}]")']);
    assert.equal(JSON.parse(stdout)[0].filename, 'ok.tgz');
    assert.doesNotMatch(stdout, /npm warn/);
    assert.match(chunks.join(''), /npm warn noise/);
  } finally { process.stderr.write = original; }
});

test('a non-zero exit includes stderr and stdout, and redacts a launch token', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.stderr.write("boom detail http://127.0.0.1:9/?token=secret-value\\n"); process.stdout.write("partial"); process.exit(2)']),
    error => error.message.includes('boom detail') && error.message.includes('partial') && error.message.includes('token=[redacted]') && !error.message.includes('secret-value'),
  );
});
