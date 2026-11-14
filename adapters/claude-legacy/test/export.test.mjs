// Exporter tests on synthetic temp mailboxes only. No private paths, no live mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportSnapshot, writeManifest, parseProcessedList, parseArgs, ExportError, FORMAT } from '../src/export.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const env = (id, from, to) => JSON.stringify({ schema: 0, message_id: id, from, to, type: 'message', created_at: '2026-01-01T00:00:00Z', payload: { text: id } });

function mailbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
  const a = path.join(root, 'alpha-pa'), b = path.join(root, 'beta-pa');
  fs.mkdirSync(a); fs.mkdirSync(path.join(b, 'processed'), { recursive: true });
  fs.writeFileSync(path.join(a, 'm1.json'), env('m1', 'beta-pa', 'alpha-pa'));
  fs.writeFileSync(path.join(a, 'm2.json'), env('m2', 'beta-pa', 'alpha-pa'));
  fs.writeFileSync(path.join(a, 'm3.json'), env('m3', 'beta-pa', 'alpha-pa'));
  fs.writeFileSync(path.join(a, '.processed'), 'm1.json\nm2.json\nm1.json\n\n');   // repeated --done line, trailing blanks
  fs.writeFileSync(path.join(a, '.tmp-123-abc'), 'partial');                       // in-flight temp: ignored
  const m4 = env('m4', 'alpha-pa', 'beta-pa');
  fs.writeFileSync(path.join(b, 'm4.json'), m4);
  fs.writeFileSync(path.join(b, 'processed', 'm4.json'), JSON.stringify({ message_id: 'm4', source_sha256: sha(m4), status: 'completed', outcome: 'ok' }));
  return { root, a, b };
}
const run = (root, extra = {}) => exportSnapshot({ mailRoot: root, allowedSenders: ['alpha-pa', 'beta-pa'], ...extra });

test('exports exact sources, hashes, receipts and the processed list', () => {
  const { root, a } = mailbox();
  const { manifest, summary } = run(root);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.records.length, 4);
  for (const r of manifest.records) assert.equal(r.sha256, sha(r.source));
  assert.equal(manifest.records.find((r) => r.filename === 'm4.json').receipt.includes('"completed"'), true);
  assert.equal(manifest.processed_lists.length, 1);
  const pl = manifest.processed_lists[0];
  assert.deepEqual([pl.recipient, pl.format, pl.sha256], ['alpha-pa', FORMAT, sha(fs.readFileSync(path.join(a, '.processed')))]);
  assert.deepEqual(summary.find((s) => s.recipient === 'alpha-pa'), { recipient: 'alpha-pa', records: 3, receipts: 0, processed_listed: 2, unlisted_without_receipt: 1 });
  assert.ok(!JSON.stringify(manifest).includes('_stamp'));
});

test('never modifies the originals', () => {
  const { root, a } = mailbox();
  const before = fs.readdirSync(a).map((n) => [n, fs.readFileSync(path.join(a, n), 'utf8')]);
  run(root);
  assert.deepEqual(fs.readdirSync(a).map((n) => [n, fs.readFileSync(path.join(a, n), 'utf8')]), before);
});

const refusals = [
  ['a processed marker naming a missing record', ({ a }) => fs.appendFileSync(path.join(a, '.processed'), 'gone.json\n'), /missing record/],
  ['an unsafe name in the processed list', ({ a }) => fs.appendFileSync(path.join(a, '.processed'), '../x.json\n'), /unsafe name/],
  ['a padded name in the processed list', ({ a }) => fs.appendFileSync(path.join(a, '.processed'), ' m1.json \n'), /unsafe name/],
  ['a symlinked envelope', ({ a }) => fs.symlinkSync(path.join(a, 'm1.json'), path.join(a, 'link.json')), /not a regular file/],
  ['a non-UTF-8 envelope', ({ a }) => fs.writeFileSync(path.join(a, 'bad.json'), Buffer.from([0xff, 0xfe, 0x7b])), /UTF-8/],
  ['a directory named like an envelope', ({ a }) => fs.mkdirSync(path.join(a, 'dir.json')), /not a regular file/],
];
for (const [name, mutate, re] of refusals) test(`refuses ${name}`, () => {
  const box = mailbox(); mutate(box);
  assert.throws(() => run(box.root), (e) => e instanceof ExportError && re.test(e.message));
});

test('refuses a mailbox that changes during the snapshot', () => {
  const box = mailbox();
  assert.throws(() => run(box.root, { afterFirstPass: () => fs.writeFileSync(path.join(box.a, 'late.json'), env('late', 'beta-pa', 'alpha-pa')) }),
    /changed during snapshot/);
  const box2 = mailbox();
  assert.throws(() => run(box2.root, { afterFirstPass: () => fs.appendFileSync(path.join(box2.a, '.processed'), 'm3.json\n') }),
    /changed during snapshot/);
});

test('refuses bad sender or recipient arguments', () => {
  const { root } = mailbox();
  assert.throws(() => exportSnapshot({ mailRoot: root, allowedSenders: [] }), ExportError);
  assert.throws(() => run(root, { recipients: ['alpha-pa', 'alpha-pa'] }), /duplicate recipient/);
  assert.throws(() => run(root, { recipients: ['Bad Name'] }), /no valid recipients/);
  assert.throws(() => run(root, { recipients: [undefined] }), /no valid recipients/);
  for(const args of [['--recipents','alpha-pa'],['--out','one','--out','two']])assert.throws(()=>parseArgs(args),/unknown or repeated/);
});

test('writes the manifest once and never overwrites', () => {
  const { root } = mailbox();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'out-')), 'manifest.json');
  const { manifest } = run(root);
  assert.match(writeManifest(out, manifest), /^[a-f0-9]{64}$/);
  assert.throws(() => writeManifest(out, manifest), /EEXIST/);
});

test('processed-list parsing de-duplicates and ignores blank lines', () => {
  assert.deepEqual([...parseProcessedList('a.json\r\nb.json\na.json\n\n  \n')], ['a.json', 'b.json']);
});
