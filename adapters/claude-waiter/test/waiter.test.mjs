// End-to-end tests of the BUNDLED waiter (dist/claude-waiter.mjs, what ships) against the mock service,
// plus table-driven argument checks on the source. Synthetic data only; no real PA, inbox or config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-service.mjs';
import { parseArgs, UsageError } from '../src/waiter.mjs';

const BUNDLE = new URL('../dist/claude-waiter.mjs', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waiter-'));
const tokenFile = (t) => { const f = path.join(tmp, `tok-${Math.random().toString(16).slice(2)}`); fs.writeFileSync(f, t + '\n'); return f; };

function runWaiter(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BUNDLE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => { p.kill(); reject(new Error(`waiter did not exit in ${timeoutMs} ms; stdout=${out} stderr=${err}`)); }, timeoutMs);
    p.on('exit', (code) => { clearTimeout(t); const last = out.trim().split('\n').pop(); resolve({ code, json: last ? JSON.parse(last) : null, err }); });
  });
}
const base = (m, extra = []) => ['--url', m.url, '--recipient', 'claude-pa', '--token-file', tokenFile('synthetic-token'), ...extra];

test('exits 0 at once when work is already pending', async () => {
  const m = await startMock(); m.state.pending = 2;
  try { const r = await runWaiter(base(m)); assert.equal(r.code, 0); assert.equal(r.json.status, 'pending'); assert.equal(r.json.pending_count, 2); }
  finally { await m.close(); }
});

test('keeps waiting through timeouts, exits 0 when work arrives', async () => {
  const m = await startMock();
  try {
    setTimeout(() => (m.state.pending = 1), 1500);
    const r = await runWaiter(base(m, ['--wait-ms', '300']));
    assert.equal(r.code, 0); assert.equal(r.json.status, 'pending');
    assert.ok(m.state.calls >= 2, `expected more than one bounded wait, got ${m.state.calls}`);
  } finally { await m.close(); }
});

test('never wakes a paused recipient (runs out its max-run instead)', async () => {
  const m = await startMock(); m.state.pending = 3; m.state.paused = true;
  try { const r = await runWaiter(base(m, ['--wait-ms', '200', '--max-run-s', '2'])); assert.equal(r.code, 6); assert.equal(r.json.status, 'max_run'); }
  finally { await m.close(); }
});

test('wrong token exits 3 without retrying', async () => {
  const m = await startMock();
  try {
    const r = await runWaiter(['--url', m.url, '--recipient', 'claude-pa', '--token-file', tokenFile('wrong-token')]);
    assert.equal(r.code, 3); assert.equal(r.json.status, 'auth_refused');
  } finally { await m.close(); }
});

test('token scoped to another recipient exits 3', async () => {
  const m = await startMock({ recipient: 'codex-pa' });
  try { const r = await runWaiter(base(m)); assert.equal(r.code, 3); }
  finally { await m.close(); }
});

test('result for the wrong recipient is a protocol error (exit 5)', async () => {
  const m = await startMock(); m.state.pending = 1; m.state.wrongRecipient = true;
  try { const r = await runWaiter(base(m)); assert.equal(r.code, 5); assert.equal(r.json.status, 'protocol_error'); }
  finally { await m.close(); }
});

test('service down beyond the budget exits 4', async () => {
  const m = await startMock(); const url = m.url; await m.close();
  const r = await runWaiter(['--url', url, '--recipient', 'claude-pa', '--token-file', tokenFile('synthetic-token'), '--down-budget-s', '2']);
  assert.equal(r.code, 4); assert.equal(r.json.status, 'service_down');
});

test('recovers when the service comes back within the budget', async () => {
  const first = await startMock(); const port = first.port; await first.close();
  const p = runWaiter(['--url', `http://127.0.0.1:${port}/mcp`, '--recipient', 'claude-pa', '--token-file', tokenFile('synthetic-token'), '--down-budget-s', '30']);
  await new Promise((r) => setTimeout(r, 1500));
  const m = await startMock({ port }); m.state.pending = 1;
  try { const r = await p; assert.equal(r.code, 0); assert.equal(r.json.status, 'pending'); }
  finally { await m.close(); }
});

test('instant timeout replies (e.g. --wait-ms 0) do not busy-loop', async () => {
  const m = await startMock(); m.state.instantTimeout = true;
  try {
    const r = await runWaiter(base(m, ['--wait-ms', '0', '--max-run-s', '5']));
    assert.equal(r.code, 6);
    assert.ok(m.state.calls <= 4, `expected <= 4 round-trips in 5 s, got ${m.state.calls}`);
  } finally { await m.close(); }
});

test('errors never echo the token', async () => {
  const m = await startMock({ token: 'synthetic-token' });
  try {
    const r = await runWaiter(['--url', m.url, '--recipient', 'claude-pa', '--token-file', tokenFile('a-wrong-token-that-must-not-leak')]);
    assert.equal(r.code, 3); assert.ok(!JSON.stringify(r).includes('a-wrong-token-that-must-not-leak'));
  } finally { await m.close(); }
});

const bad = [
  ['missing url', ['--recipient', 'claude-pa', '--token-file', 'x']],
  ['non-loopback url', ['--url', 'http://example.com/mcp', '--recipient', 'claude-pa', '--token-file', 'x']],
  ['bad recipient', ['--url', 'http://127.0.0.1:1/mcp', '--recipient', 'Claude PA', '--token-file', 'x']],
  ['wait too long', ['--url', 'http://127.0.0.1:1/mcp', '--recipient', 'claude-pa', '--token-file', 'x', '--wait-ms', '30000']],
  ['unknown flag', ['--url', 'http://127.0.0.1:1/mcp', '--recipient', 'claude-pa', '--token-file', 'x', '--claim']],
];
for (const [name, args] of bad) test(`rejects ${name}`, () => assert.throws(() => parseArgs(args), UsageError));
test('accepts a valid loopback config', () => assert.equal(parseArgs(['--url', 'http://127.0.0.1:43187/mcp', '--recipient', 'claude-pa', '--token-file', 'x']).waitMs, 25000));
