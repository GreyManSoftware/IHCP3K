#!/usr/bin/env node
// Legacy mailbox snapshot exporter: freezes a schema-0 file mailbox into one import manifest for
// service/src/legacy-import.mjs. Read-only: it never edits, moves or deletes the originals.
//
//   node export.mjs --mail-root <dir> --out <manifest.json> --allowed-senders a,b [--recipients a,b]
//
// <mail-root>/<recipient>/*.json        schema-0 envelopes            -> records[]
// <mail-root>/<recipient>/processed/*   hash-bound terminal receipts   -> records[].receipt
// <mail-root>/<recipient>/.processed    claude-watch handled-filenames -> processed_lists[]
//
// The manifest holds message bodies: keep it private, never commit it.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FORMAT = 'claude-watch-filenames-v1';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.json$/;
const RECIPIENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SOURCE = 1024 * 1024;
const MAX_RECORDS = 10000;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

export class ExportError extends Error {}
const fail = (m) => { throw new ExportError(m); };

// Read a regular, unlinked file as exact UTF-8 text; refuse anything else.
function readExact(file, limit = MAX_SOURCE) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile()) fail(`not a regular file: ${path.basename(file)}`);
  if (st.size > limit) fail(`too large: ${path.basename(file)}`);
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail(`not valid UTF-8: ${path.basename(file)}`);
  return { text, sha256: sha256(bytes), size: st.size, mtimeMs: st.mtimeMs };
}

function checkDir(dir) {
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) fail(`not a plain directory: ${dir}`);
}

export function parseProcessedList(text) {
  const names = new Set();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;                             // blank / trailing lines are fine
    const line = raw;                                      // do not silently normalise a filename
    if (!NAME.test(line)) fail(`unsafe name in .processed: ${JSON.stringify(line.slice(0, 80))}`);
    names.add(line);                                       // repeated --done lines de-duplicate
  }
  return names;
}

// One pass over a recipient directory: records, receipts and the processed list.
function snapshotRecipient(root, recipient) {
  const dir = path.join(root, recipient);
  checkDir(dir);
  const records = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue;   // .processed, .tmp-*, other files
    if (!NAME.test(name)) fail(`unsafe envelope name: ${name}`);
    const src = readExact(path.join(dir, name));
    let receipt = null;
    const rfile = path.join(dir, 'processed', name);
    if (fs.existsSync(rfile)) { checkDir(path.join(dir, 'processed')); receipt = readExact(rfile).text; }
    records.push({ filename: name, recipient, source: src.text, sha256: src.sha256, receipt, _stamp: [src.size, src.mtimeMs] });
  }
  let list = null;
  const pfile = path.join(dir, '.processed');
  if (fs.existsSync(pfile)) {
    const p = readExact(pfile);
    const names = parseProcessedList(p.text);
    const have = new Set(records.map((r) => r.filename));
    for (const n of names) if (!have.has(n)) fail(`${recipient}/.processed names a missing record: ${n}`);
    list = { recipient, source: p.text, sha256: p.sha256, format: FORMAT, _stamp: [p.size, p.mtimeMs], _names: names };
  }
  return { records, list };
}

const fingerprint = (snap) => JSON.stringify([snap.records.map((r) => [r.filename, r.sha256, r.receipt && sha256(r.receipt)]),
  snap.list && snap.list.sha256]);

export function exportSnapshot({ mailRoot, recipients, allowedSenders, afterFirstPass } = {}) {
  if (!Array.isArray(allowedSenders) || !allowedSenders.length || !allowedSenders.every((s) => typeof s==='string' && RECIPIENT.test(s))) fail('allowed senders required');
  checkDir(mailRoot);
  const names = recipients ?? fs.readdirSync(mailRoot).filter((n) => !n.startsWith('.')).sort();
  if (!Array.isArray(names) || !names.length || !names.every((r) => typeof r==='string' && RECIPIENT.test(r))) fail('no valid recipients');
  if (new Set(names).size !== names.length) fail('duplicate recipient');

  const first = names.map((r) => snapshotRecipient(mailRoot, r));
  afterFirstPass?.();                                       // test hook: simulate a writer that ignored the barrier
  const second = names.map((r) => snapshotRecipient(mailRoot, r));
  first.forEach((s, i) => { if (fingerprint(s) !== fingerprint(second[i])) fail(`${names[i]} changed during snapshot; quiesce writers and retry`); });

  const records = first.flatMap((s) => s.records).map(({ _stamp, ...r }) => r);
  if (records.length > MAX_RECORDS) fail(`too many records: ${records.length}`);
  const processed_lists = first.filter((s) => s.list).map(({ list: { _stamp, _names, ...l } }) => l);
  const summary = first.map((s, i) => {
    const listed = s.list?._names ?? new Set();
    const receipts = s.records.filter((r) => r.receipt).length;
    return { recipient: names[i], records: s.records.length, receipts, processed_listed: listed.size,
      unlisted_without_receipt: s.records.filter((r) => !r.receipt && !listed.has(r.filename)).length };
  });
  return { manifest: { version: 1, allowed_senders: [...allowedSenders], records, processed_lists }, summary };
}

export function writeManifest(out, manifest) {
  const fd = fs.openSync(out, 'wx', 0o600);                  // never overwrite an earlier snapshot
  try { fs.writeFileSync(fd, JSON.stringify(manifest, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return sha256(fs.readFileSync(out));
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) fail(`bad argument near ${argv[i]}`);
    const key=argv[i].slice(2);
    if(!['mail-root','out','allowed-senders','recipients'].includes(key) || Object.hasOwn(o,key))fail('unknown or repeated argument');
    o[key] = argv[i + 1];
  }
  for (const k of ['mail-root', 'out', 'allowed-senders']) if (!o[k]) fail(`--${k} is required`);
  return { mailRoot: o['mail-root'], out: o.out, allowedSenders: o['allowed-senders'].split(','),
    recipients: o.recipients ? o.recipients.split(',') : undefined };
}

const isMain = process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const { manifest, summary } = exportSnapshot(a);
    const manifestSha = writeManifest(a.out, manifest);
    console.log(JSON.stringify({ ok: true, out: path.basename(a.out), manifest_sha256: manifestSha, summary }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e.message ?? e) }));
    process.exitCode = e instanceof ExportError ? 2 : 1;
  }
}
