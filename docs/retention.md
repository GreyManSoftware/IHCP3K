# Automatic database cleanup

The local MCP runtime performs cleanup at startup and once per minute while open. One database lease coordinates concurrent runtimes. This is ordinary Node/SQLite code: no AI calls, scheduled prompts or Docker service. When every runtime is closed, cleanup resumes on next start; no new IHCP3K traffic is written while all are closed.

| Data | Default |
| --- | --- |
| Completed message bodies | Cleared immediately |
| Completed messages, request/reply links and retry identifiers | Deleted after 90 days; linked request and reply must both be completed and old enough |
| Settled worker records | Deleted 90 days after acknowledgement, only once cleanup is settled or no native cleanup was requested |
| Inactive session directory entries | Deleted after 30 days without being seen, only when no retained messages, workers, pauses or uncertain notification references need them |
| Inactive harness registrations | Removed once sessions are gone and no recent registration audit or scan remains |
| Expired temporary leases/grants and old audit details | Collected automatically |

Pending, claimed, uncertain and unacknowledged work is never discarded merely to satisfy an age/size limit. Maintenance works in batches of 500 candidates, keeping linked pairs together.

## Capacity and disk space

New local runtimes set a **256 MiB SQLite main-file ceiling**. New messages, workers, registrations and session entries stop being admitted at **224 MiB of used pages**, leaving space to finish or reconcile existing work. There are also limits of 100,000 message records, 10,000 worker records, 50,000 directory entries and 1,000 harness records. Active harnesses remain limited to 16. Requests already recorded remain idempotent within the retention window.

Freed SQLite pages are reused. New databases enable incremental vacuum, reclaiming up to 256 free pages each maintenance pass. Existing databases without that mode still reuse free pages and obey the size ceiling; enabling physical shrinkage requires an offline vacuum. An already oversized imported file cannot be shrunk by merely setting a lower page limit.

The runtime checkpoints the write-ahead log (WAL). If a reader prevents checkpointing and the WAL exceeds **32 MiB**, further transactions pause with `DATABASE_WAL_CAPACITY` until the reader releases it. This is a write threshold, not an exact total-disk quota: the transaction crossing it can overshoot, and SQLite has additional journal/shared-memory files. The main-file ceiling does not permit endless WAL growth. Capacity failures return `DATABASE_CAPACITY`; existing records remain intact.

Retention measurements are saved under `last_retention` in database metadata. Cleanup does not manage unrelated files or operator backups. See SQLite's [page limits and vacuum settings](https://www.sqlite.org/pragma.html) and [WAL checkpoint behaviour](https://www.sqlite.org/wal.html).

## Retry window

Duplicate prevention is finite: a completed request's identity may be removed after 90 days. An old request ID then returns not found; reusing an expired idempotency key can create new work. Never automatically replay ancient work or infer that a missing historical record means no external effect occurred. Check the external outcome and obtain current task authority before submitting it again.

These rules apply to the local shared runtime. Legacy Docker/HTTP mode retains its older contract and is not the default installation.
