# Migration and offline restore

Use this guide to move stored data or restore a backup. The **source** is the old installation; the **destination** is the new private folder. **Reconciliation** means inspecting incomplete requests and checking whether they already caused changes before retrying them. A **cutover** is the later, explicit switch of clients to the destination. See [terminology](terminology.md) for backup and message-state terms.

Version 1.1 uses schema 6 and harness-wide credentials. A version 1.0/schema-5 runtime cannot be reused in place. Restore a verified offline snapshot to a new directory, then register the harnesses with fresh credentials. Restored harness registrations are disabled, session addresses remain inactive and old tokens stay revoked. Native session discovery repopulates the active directory only after intentional registration.

## v1.1.0 local installation from an offline backup

This is an explicit offline operation, separate from normal installation and live cutover. A restore does not itself switch a live installation. Respect actual native execution restrictions throughout the migration. Do not start an older HTTP owner alongside new stdio writers or let two databases accept normal traffic as the same authority.

1. Agree a single migration owner and barrier; stop every source writer/consumer, including old HTTP and any stdio connections. Record the source version and consistent backup identity privately.
2. Obtain a verified SQLite snapshot/backup including committed WAL data and its SHA-256. Copying only a running `.db` file is not a consistent backup. Preserve the source and evidence unchanged.
3. Ask for a new private destination and the working folder used by temporary notification processes. Restore with the explicit backup arguments:

```sh
node scripts/install-local.mjs /absolute/private/new-ihcp /absolute/private/offline-backup.db <sha256> --workdir /absolute/chosen/working-folder
```

The backup path is absolute and `<sha256>` is the verified 64-character lowercase digest, not literal placeholder text. The destination must be new; ordinary installer reuse cannot import into an existing runtime. The source backup must already be a stable standalone snapshot.

The installer verifies the hash and database integrity, restores into the new private root and assigns fresh service identity/administrator credentials. Registered credentials are revoked, endpoints disabled with new revisions, enrolments cleared, and unfinished mail fenced into reconciliation with restore pauses. Existing worker execution/cleanup uncertainty remains for review. No source writes, live route switch, native configuration edits, worker continuation or unpause occur. Notification/worker configuration starts empty.

After inspecting counts, hashes, claims, reply links and effects, explicitly relink endpoints and review native bindings. Preserve source/current state for comparison. Only an authorized separate cutover may choose the new authority and clear the relevant restore pauses; do not clear unrelated pauses. Newer messages/effects must be reconciled before rollback or activation. Never infer that restore success means those steps occurred.

The local installer consumes a backup; it is not a backup-creation command. The older `ops.mjs backup/restore` commands below apply only to Docker/HTTP manifests. Do not point them at a stdio manifest.

## Historical schema-0 mailbox import — Docker/HTTP

The importer is an explicit, offline transition from the earlier schema-0 mailbox. The database remains the only live authority after cutover. It never watches a directory or continuously mirrors files.

After freezing every legacy writer and consumer, generate a private snapshot:

```sh
node adapters/claude-legacy/src/export.mjs --mail-root /private/old-mail --recipients alpha-pa,beta-pa --allowed-senders alpha-pa,beta-pa --out /private/snapshot.json
```

The exporter reads twice and refuses changed input, unsafe filenames, symlinks, invalid UTF-8, missing marked records and output overwrites. This check detects changes during the reads; it does not replace the agreed writer freeze. It never changes the originals. The printed summary and manifest hash are evidence for the cutover owner to verify.

Pass that UTF-8 JSON file to `scripts/ops.mjs <runtime.json> import <manifest.json>` after stopping the service:

```json
{
  "version": 1,
  "allowed_senders": ["alpha-pa", "beta-pa"],
  "records": [
    {
      "filename": "original-message-id.json",
      "recipient": "beta-pa",
      "source": "<exact original UTF-8 message text>",
      "sha256": "<SHA-256 of those source bytes>",
      "receipt": "<exact original receipt JSON text, or null>"
    }
  ],
  "processed_lists": [
    {
      "recipient": "beta-pa",
      "source": "original-message-id.json\n",
      "sha256": "<SHA-256 of the exact processed-list bytes>",
      "format": "claude-watch-filenames-v1"
    }
  ]
}
```

The source envelope must have `schema:0`, a filename-matching `message_id`, an allowed `from`, and `to` matching a registered recipient. A receipt must name that message and match the source hash through `source_sha256` or the earlier `sha256` field. If both hash fields exist they must agree.

Completed, rejected and blocked receipts become completed tombstones with no body. In version 0.2.1+, an exact filename in that recipient's verified processed list also becomes a completed tombstone, with distinct `legacy-processed-list` provenance. Duplicate marker lines and blank lines are harmless; padded names, paths, missing records and conflicting nonterminal receipts are rejected. Source and list hashes remain in metadata even after outcome-detail cleanup.

Unmarked records without terminal receipts become `reconcile`, never pending. Invalid identity, changed input, receipt mismatch or capacity failure rolls back the whole import. Repeating an unchanged manifest is idempotent. Changing the terminal evidence of an already-imported record fails for explicit reconciliation; reimporting cannot silently change its state.

The importer accepts at most 10,000 records, source records up to 1 MiB and normalized message bodies up to 65,536 bytes. Reject and investigate larger records rather than truncating history silently.

The `.processed` format records only filenames. Its snapshot hash proves which list was imported; it does not prove that the old consumer recorded per-message hashes or verified message contents. Obtain the owning consumer's reconciliation before using it. Do not invent stronger historical receipts or replay already-handled work.

Keep the original snapshot private. Its exact bytes matter. A cutover coordinator must freeze old writers and consumers, compare counts/hashes, review uncertain records and change the sender route once. The importer does not itself stop other processes or switch a caller's transport.

If cutover fails, keep the new database intact. Reconcile messages and effects created since the barrier before reverting any routing; never blindly restore an old snapshot or auto-fallback to file delivery.
