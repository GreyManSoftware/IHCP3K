# Legacy mailbox import

The importer is an explicit, offline transition from the earlier schema-0 mailbox. The database remains the only live authority after cutover. It never watches a directory or continuously mirrors files.

Pass a UTF-8 JSON file to `scripts/ops.mjs <runtime.json> import <manifest.json>` after stopping the service:

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
  ]
}
```

The source envelope must have `schema:0`, a filename-matching `message_id`, an allowed `from`, and `to` matching a registered recipient. A receipt must name that message and match the source hash through `source_sha256` or the earlier `sha256` field. If both hash fields exist they must agree.

Completed, rejected and blocked receipts become completed tombstones with no body. Missing or nonterminal receipts become `reconcile`, never pending. Invalid identity, changed input, receipt mismatch or capacity failure rolls back the whole import. Repeating an unchanged manifest is idempotent.

The importer accepts at most 10,000 records, source records up to 1 MiB and normalized message bodies up to 65,536 bytes. Reject and investigate larger records rather than truncating history silently.

Some older consumers recorded handled filenames in a `.processed` list instead of hash-bound receipts. This importer does not yet accept that format. Preserve and hash the list with the source snapshot, obtain the owning consumer's reconciliation, and add an explicitly tested migration path before cutover. Do not invent historical hash receipts, discard the list or replay already-handled work.

Keep the original snapshot private. Its exact bytes matter. A cutover coordinator must freeze old writers and consumers, compare counts/hashes, review uncertain records and change the sender route once. The importer does not itself stop other processes or switch a caller's transport.

If cutover fails, keep the new database intact. Reconcile messages and effects created since the barrier before reverting any routing; never blindly restore an old snapshot or auto-fallback to file delivery.
