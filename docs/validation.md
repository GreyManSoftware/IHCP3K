# Validation

Version 0.2.0 was checked on Windows with Docker, Node 24.15.0 and SQLite 3.51.3. The Docker base is pinned by digest in the runners.

`node scripts/dev.mjs test` passed **34 tests**:

- 17 service tests: authentication/scope, concurrent duplicate sends, fenced claims, pauses, abrupt process death, notification reservations, WAL backup, quarantined restore and atomic legacy import.
- 16 waiter tests: official-SDK connection behavior, pause handling, bounded waits, recovery and secret redaction.
- 1 table-driven native-queue test: accepted output, silent success, warned failure, nonzero exit and timeout.

Additional checks:

- Native Claude and Codex CLI clients each completed send → claim → complete against the synthetic demo using file-backed credential helpers. Dotted tool names worked in both.
- The private live-mode service started on a loopback-only port, passed authenticated health/status checks, and passed a deployed backup/restore operation. Restore produced a separate paused database; it did not replace the active one.
- Follow-up live peer probes passed in both directions: send, bounded wake, claim and completion. Claude's scoped client rejected a foreign-inbox claim; its background waiter produced a native PA notification. A fresh Claude session loaded the user-scoped sender, while the running PA did not hot-load it.
- Codex's native queue delivered a transport-only test on the next turn after a busy publication turn ended. This is separate from end-to-end bridge validation.
- A fresh-clone mountpoint problem was fixed in the Docker runner.
- Before the public export, eight independent waiter/service integration scenarios passed.

Not yet verified:

- Full clean-install flow through `init-runtime.mjs` and `ops.mjs`: the host's automatic approval review blocked the separate initializer/start/status/backup/stop probe with the generic reason “blocked by policy.” Syntax checks, service tests and the deployed operations above still passed.
- Codex desktop reload, app-closed wake and OS-start recovery. The tested running Claude PA required the explicit SDK client rather than hot-loading the new native server.
- The persistent Codex wake bridge: automatic approval review rejected its hidden background launch with “blocked by policy.” No alternate launch was attempted.
- Full live mailbox cutover. The existing mailbox remains authoritative; live connection tests do not prove that migration is complete.

The release includes implementation and operator instructions for these paths, with their limits stated. It is experimental, not a claim of unattended production operation. Private runtime evidence, tokens and session mappings are excluded from Git.
