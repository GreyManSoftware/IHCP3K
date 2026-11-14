# Live cutover

One coordinator owns this transition. Keep credentials, source messages and evidence private.

1. Verify each scoped client and its actual notification path. Record who owns each waiter process and what happens when that session closes. An installed configuration is not proof of a loaded connection.
2. Agree a barrier with every old sender and consumer, including receipt writers. Stop them; make legacy entry points refuse new work. Preserve their original configuration for recovery.
3. Back up the current database. Export the frozen file mailbox using [the migration guide](migration.md), then verify hashes, counts and historical sender identities. Do not silently discard unmatched markers.
4. Stop the service and import offline. Completed history becomes tombstones; uncertain history stays quarantined. Preserve live MCP records already accepted before the barrier.
5. Restart and verify both inboxes and waiter reconnection. Record MCP as the only live transport. Stale callers must fail rather than deliver to files.
6. Inspect quarantine against actual outcomes. Requeue only work that is still authorized and known not to have happened. Owner-requested discard uses `control.resolve` with `action:"abandon"`, the observed generation and a reason.
7. Confirm peers are using MCP, then retire the old watchers and update shared instructions. Source archives and backups have a separate retention decision; deleting a directory is not what makes the transport switch complete.

## Recovery

Before any rollback, freeze new dispatch and reconcile messages and effects accepted after the barrier. Keep the active database intact. Restore a verified backup into a **separate paused database**, compare it with current state, and explicitly choose which transport will own delivery before resuming. Never restore over the live database, run both writers, replay completed history or fall back automatically to files.

Deleting historical snapshots removes that recovery source. If the owner requests cleanup, remove the agreed message copies and backups, keep only necessary duplicate-protection metadata, and record what was actually removed. Logical deletion is not a secure-erasure guarantee.
