# Explicit live cutover and recovery

A **cutover** switches all connected clients from an old installation to its replacement. A **barrier** is an agreed stop point: every sender and receiver confirms it has stopped using the old installation. **Reconciliation** means checking what work actually happened before deciding whether a request can safely be retried. See [terminology](terminology.md) for the database and credential terms below.

**v1.4.0.** This is a migration checklist, not an installation prerequisite. Native setup is an explicit operation; any actual execution denial must be respected without assuming it applies to unrelated setup paths. This checklist describes the required transition, not authorization to perform it or bypass a denial.

One coordinator owns the transition. Keep all identities, credentials, messages and evidence private. Multiple compatible stdio connections may share one database; an older exclusive HTTP writer or an independent second live database must not share its authority.

1. Verify scoped clients and their actual native notification paths on the installed versions. Record endpoint revisions, exact native host/session bindings and process ownership. An emitted config snippet or queued message notification is not proof of a loaded client or completed work.
2. Establish a barrier with every old sender/consumer, including receipt writers and active workers. Stop owned processes through their supported lifecycle; resolve uncertain work before cleanup. Preserve original configuration for recovery.
3. Take a consistent offline snapshot/backup with integrity/hash evidence. Follow [migration](migration.md) for explicit restore to a new private root. Historical file-mailbox export/import is a separately labeled older workflow, not part of every upgrade.
4. Inspect the restored paused state, counts, dedup identities, request/reply links, worker results and unresolved effects. Revoked registered credentials and disabled endpoints require explicit relink; do not simply copy old token files back.
5. Once permitted, prepare the exact native binding/config changes for explicit setup, select the sole authority once, and clear only reviewed pauses. Verify harmless bidirectional correlated delivery with the configured adapters. Stale callers must fail rather than use a retired mailbox.
6. Reconcile uncertain outcomes before `control.resolve` or `control.reset_wake`, using the expected generation and a reason. Requeue only still-authorized work known not to have happened. Never use silence or elapsed time as evidence of takeover.
7. Record the authority, runtime version/bundle, chosen working/private folders, process owners and recovery checkpoint privately. Retire only verified obsolete adapters. Historical snapshots/backups have a separate cleanup decision.

## Recovery

Freeze new dispatch and reconcile messages/effects accepted after the barrier before rollback. Keep the current database intact. Restore a verified snapshot to a separate paused database and compare it with current state; choose one authority explicitly before resuming. Never restore over live state, dual-write, replay completed history or auto-fallback to files.

Native configuration and cleanup permissions remain independent. Removal of an old directory is not what establishes a cutover. If historical data deletion is explicitly chosen, preserve required duplicate/recovery records and report actual deletion results. Native worker cleanup still requires an acknowledged successful durable result and verified exit; no raw transcript deletion or secure-erasure claim is implied.
