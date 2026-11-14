# Validation

Version 0.3.0 adds bounded receiver attendance and direct request/reply waiting. Checked on Windows with Docker, Node 24.15.0 and SQLite 3.51.3. The Docker base is pinned by digest in the runners.

`node scripts/dev.mjs test` passed **52 tests**:

- 22 service tests: authentication/scope, concurrent duplicate sends, fenced claims, pauses, abrupt process death, notification reservations, bounded attendance, direct receiving, WAL backup, quarantined restore and atomic legacy import. Attendance checks cover ownership, expiry, stale tokens, abort/timeout cleanup, release-to-wake fallback and an official-SDK peer exchange, including failed-send cleanup.
- 16 waiter tests: official-SDK connection behavior, pause handling, bounded waits, recovery and secret redaction.
- 1 table-driven native-queue test: accepted output, silent success, warned failure, nonzero exit and timeout.
- 13 legacy-export tests: exact snapshots, unchanged originals, malformed inputs, concurrent changes, write-once output and an exporter-to-importer round trip covering both receipt formats, quarantine and duplicate protection.

Additional checks:

- A live Codex-to-Claude exchange received and completed Claude's acknowledgement during attendance without another bridge notification. Attendance was released, and Claude adopted the same helper for active reply waits. A preliminary self-send was correctly rejected by the existing peer-only send scope; permissions were not expanded.

- Native Claude and Codex CLI clients each completed send → claim → complete against the synthetic demo using file-backed credential helpers. Dotted tool names worked in both.
- The private live-mode service started on a loopback-only port, passed authenticated health/status checks, and passed a deployed backup/restore operation. Restore produced a separate paused database; it did not replace the active one.
- Follow-up live peer probes passed in both directions: send, bounded wake, claim and completion. Claude's scoped client rejected a foreign-inbox claim; its background waiter produced a native PA notification. A fresh Claude session loaded the user-scoped sender, while the running PA did not hot-load it.
- Codex's native queue delivered a transport-only test on the next turn after a busy publication turn ended. This is separate from end-to-end bridge validation.
- A user-started, Claude-session-owned attached bridge subsequently delivered an MCP notification into the existing Codex PA. Both waiters reconnected after a service restart. This proves session-bound delivery, not unattended startup.
- Live legacy import completed after both consumers stopped file delivery. Handled messages became tombstones; uncertain messages stayed quarantined until the owner explicitly requested their abandonment. No historical work replayed. Legacy sender and watcher entry points now refuse file operations, and MCP is the sole active transport.
- A pre-cutover database backup and source/script checkpoint were retained. After the initial rename and deletion failures, the owner independently arranged deletion of the retired mailbox directory; its absence was verified. Migration exports and saved claim copies still exist. Retiring delivery and deleting every historical copy are separate outcomes.
- A fresh-clone mountpoint problem was fixed in the Docker runner.
- Before the public export, eight independent waiter/service integration scenarios passed.

Not yet verified:

- Full clean-install flow through `init-runtime.mjs` and `ops.mjs`: execution policy blocked the separate initializer/start/status/backup/stop probe with the generic reason “blocked by policy.” No specific enforcement layer or rationale was supplied. Syntax checks, service tests and the deployed operations above still passed.
- Codex desktop reload, app-closed wake and OS-start recovery. The tested running Claude PA required the explicit SDK client rather than hot-loading the new native server.
- An independently persistent Codex wake bridge: its hidden launch was rejected with “blocked by policy,” including an explicitly approved retry. The observed bridge is owned by a live Claude session and stops when that task ends.
- Complete cleanup of historical copies beyond the removed mailbox directory, including migration exports, saved claims and backups. The earlier deletion command was rejected by execution policy; removal of those remaining copies has not been verified.

The release includes implementation and operator instructions for these paths, with their limits stated. It is experimental, not a claim of unattended production operation. Private runtime evidence, tokens and session mappings are excluded from Git.
