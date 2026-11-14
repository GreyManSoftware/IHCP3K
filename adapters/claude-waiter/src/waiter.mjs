// claude-waiter: wake adapter for a Claude Code PA session.
//
// The PA starts this as a background task. It loops on the coordination service's adapter-only
// `wake.wait` MCP tool and EXITS when the recipient has pending work; that exit is what wakes the
// live Claude session (background-task completion). It never claims or reads message bodies:
// after waking, the PA claims through its own MCP tools, then re-arms this waiter.
//
//   node claude-waiter.mjs --url http://127.0.0.1:<port>/mcp --recipient <name> --token-file <path>
//        [--wait-ms 25000] [--down-budget-s 600] [--max-run-s 0]
//
// Exit codes (stdout carries one JSON line describing the outcome):
//   0  pending work           -> PA should claim its inbox
//   2  usage / config error
//   3  authentication or authorisation refused (do not retry blindly)
//   4  service unreachable for longer than --down-budget-s
//   5  protocol error (unexpected result shape or tool error)
//   6  --max-run-s elapsed with nothing pending (only when set; 0 = run until work arrives)
// "paused" and "timeout" results keep it waiting; a paused recipient is never woken.
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const EXIT = { PENDING: 0, USAGE: 2, AUTH: 3, DOWN: 4, PROTOCOL: 5, MAX_RUN: 6 };
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseArgs(argv) {
  const o = { waitMs: 25000, downBudgetS: 600, maxRunS: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    switch (k) {
      case '--url': o.url = v; i++; break;
      case '--recipient': o.recipient = v; i++; break;
      case '--token-file': o.tokenFile = v; i++; break;
      case '--wait-ms': o.waitMs = Number(v); i++; break;
      case '--down-budget-s': o.downBudgetS = Number(v); i++; break;
      case '--max-run-s': o.maxRunS = Number(v); i++; break;
      default: throw new UsageError(`unknown argument ${k}`);
    }
  }
  if (!o.url || !o.recipient || !o.tokenFile) throw new UsageError('--url, --recipient and --token-file are required');
  let u; try { u = new URL(o.url); } catch { throw new UsageError('--url is not a URL'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !process.env.CLAUDE_WAITER_ALLOW_REMOTE)
    throw new UsageError('--url must be loopback');   // tokens never leave the machine by default
  if (!NAME.test(o.recipient)) throw new UsageError('--recipient must match ' + NAME);
  if (!Number.isInteger(o.waitMs) || o.waitMs < 0 || o.waitMs > 25000) throw new UsageError('--wait-ms must be 0..25000');
  if (!(o.downBudgetS >= 0) || !(o.maxRunS >= 0)) throw new UsageError('budgets must be >= 0');
  return o;
}

export class UsageError extends Error {}
class AuthError extends Error {}
class ProtocolError extends Error {}

function readToken(file) {
  const t = fs.readFileSync(file, 'utf8').trim();   // file, not argv/env: keeps it out of process listings
  if (!t || /\s/.test(t)) throw new UsageError('token file is empty or malformed');
  return t;
}

const isAuth = (e) => /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(String(e?.message ?? e)) || e?.code === 401 || e?.code === 403;
const isNetwork = (e) => /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|fetch failed|socket hang up|terminated|other side closed|\b50[234]\b/i
  .test(String(e?.message ?? e) + String(e?.cause?.code ?? '') + String(e?.cause?.message ?? ''));

export function validateResult(res, recipient) {
  if (res?.isError) {
    const text = (res.content ?? []).map((c) => c.text ?? '').join(' ');
    if (/unauthori[sz]ed|forbidden|scope|not allowed/i.test(text)) throw new AuthError(text || 'tool refused');
    throw new ProtocolError(`wake.wait returned an error: ${text}`);
  }
  let s = res?.structuredContent;
  if (!s) {   // fall back to the JSON text content the service also sends
    const t = res?.content?.find((c) => c.type === 'text')?.text;
    try { s = t ? JSON.parse(t) : undefined; } catch { /* handled below */ }
  }
  if (!s || !['pending', 'timeout', 'paused'].includes(s.status)) throw new ProtocolError('unexpected wake.wait result shape');
  if (s.recipient !== recipient) throw new ProtocolError(`result is for ${s.recipient}, not ${recipient}`);
  if (s.status === 'pending' && !(Number.isInteger(s.pending_count) && s.pending_count > 0))
    throw new ProtocolError('pending result without a positive pending_count');
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONNECT_TIMEOUT_MS = 15000;
const MIN_ITERATION_MS = 2000;   // floor per wait round-trip: no busy loop on --wait-ms 0 or instant 'timeout' replies

// One connected client; re-created after any transport failure (re-initialises the MCP session).
async function connect(url, token) {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'claude-waiter', version: '0.1.0' });
  await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });   // bounds a hung initialise
  return client;
}

export async function run(opts, { log = (o) => console.log(JSON.stringify(o)), now = () => Date.now(), connectFn = connect } = {}) {
  const token = readToken(opts.tokenFile);
  const started = now();
  let client = null, downSince = null, backoff = 1000;
  const redact = (e) => String(e?.message ?? e).split(token).join('[redacted]').slice(0, 500);
  try {
    for (;;) {
      if (opts.maxRunS && now() - started >= opts.maxRunS * 1000) {
        log({ status: 'max_run', recipient: opts.recipient }); return EXIT.MAX_RUN;
      }
      try {
        const iterStart = now();
        client ??= await connectFn(opts.url, token);
        const res = await client.callTool({ name: 'wake.wait', arguments: { recipient: opts.recipient, timeout_ms: opts.waitMs } },
          undefined, { timeout: opts.waitMs + 15000 });
        downSince = null; backoff = 1000;
        const s = validateResult(res, opts.recipient);
        if (s.status === 'pending') {
          log({ status: 'pending', recipient: s.recipient, pending_count: s.pending_count, observed_at: s.observed_at, instance_id: s.instance_id });
          return EXIT.PENDING;
        }
        if (s.status === 'paused') await sleep(Math.min(30000, Math.max(MIN_ITERATION_MS, opts.waitMs)));   // never wake a paused PA
        // 'timeout' (possibly with pending_count > 0 while the service rate-limits wakes): wait again,
        // but never faster than MIN_ITERATION_MS per round-trip.
        const spent = now() - iterStart;
        if (spent < MIN_ITERATION_MS) await sleep(MIN_ITERATION_MS - spent);
      } catch (e) {
        if (e instanceof UsageError) throw e;
        if (e instanceof AuthError || isAuth(e)) { log({ status: 'auth_refused', recipient: opts.recipient, error: redact(e) }); return EXIT.AUTH; }
        if (e instanceof ProtocolError) { log({ status: 'protocol_error', recipient: opts.recipient, error: redact(e) }); return EXIT.PROTOCOL; }
        if (!isNetwork(e) && !/timed? ?out/i.test(String(e?.message))) {
          log({ status: 'protocol_error', recipient: opts.recipient, error: redact(e) }); return EXIT.PROTOCOL;
        }
        try { await client?.close(); } catch { /* ignore */ }
        client = null;
        downSince ??= now();
        if (now() - downSince >= opts.downBudgetS * 1000) {
          log({ status: 'service_down', recipient: opts.recipient, since: new Date(downSince).toISOString(), error: redact(e) });
          return EXIT.DOWN;
        }
        await sleep(backoff + Math.floor(Math.random() * 250));
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  } finally {
    try { await client?.close(); } catch { /* ignore */ }
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  let code;
  try { code = await run(parseArgs(process.argv.slice(2))); }
  catch (e) {
    console.log(JSON.stringify({ status: e instanceof UsageError ? 'usage_error' : 'error', error: String(e.message ?? e) }));
    code = e instanceof UsageError ? EXIT.USAGE : EXIT.PROTOCOL;
  }
  // No immediate process.exit(): on Windows, exiting while undici's handles are still closing trips a
  // libuv assertion (Windows async handles) and turns the exit code into 127. Let the loop drain instead,
  // with an unref'd backstop in case a keep-alive socket lingers.
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
}
