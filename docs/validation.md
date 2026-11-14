# Validation

## v0.5 candidate — not published or live

This candidate has not been published or cut over live. Existing live-cutover/native-configuration changes remain policy-blocked. No configuration workaround or clean end-to-end native installation is implied by local tests.

Validation completed on 14 November 2026 against the candidate source and freshly built bundles:

- Full service suite: **69 passed**, including 13 experimental AHP transport fixtures.
- Legacy Claude waiter: **16 passed**; native queue fixture: **1 passed**; legacy import adapter: **13 passed**.
- Local installer: **7 passed** in Docker. Total across these suites: **106 passed**.
- The same **7 installer tests passed on Windows**, including protected ACLs, strict reuse, offline import, SDK stdio connections and a synthetic request/reply workflow. This is a platform rerun, not seven additional unique behaviors. Windows backup flushes require a writable file handle; that failure was fixed and the affected tests rerun.
- Claude's source review closed with no remaining material blockers after concurrency and shutdown fixes. It did not independently rerun the suites or validate real Copilot hosts.

Coverage includes cross-process deduplication/fencing, bounded waiter leases and throttled presence writes, rollback after process death, atomic correlated replies, failed/late worker result persistence, cleanup gating and restore with paused mail/revoked registered credentials. SQLite's native busy retry is bounded to five seconds; transaction callbacks are not replayed on contention. General maintenance intentionally retains a one-minute cadence. These are implementation checks, not proof of a native model doing work or receiving a doorbell.

Public-source checks found no private path/session identifiers or matches against the installation's private credential files. Repository author/committer email history uses the GitHub noreply identity. These checks do not constitute a security audit.

## Native behavior still pending

New native adapter execution is fixture/mock-tested beyond the earlier peer evidence. No current end-to-end claim is made for:

- Claude's combined no-persist plus `ListAgents`/`SendMessage` configuration on the actual CLI and Desktop engines; idle/busy/unavailable or duplicate-name targets.
- Codex queue delivery on the owning server across idle/busy/unloaded states; warning handling is distinct from target consumption.
- Native worker result parsing, cancellation, child exit, ambient MCP/hook restrictions and descendant/remote-task ownership on the installed versions.
- Codex archive/delete effects, exact worker identity, acknowledgement gating and delayed cleanup after restart. Command presence is not proof of erasure.
- Copilot experimental worker results or live AHP access to an existing owning host/session. Documented routes remain untested and may need changes.
- Native configuration reload, concurrent-chat endpoint bindings and harness-specific stdio process ownership. No one-process-per-chat guarantee is assumed.
- App-closed delivery, unattended startup, a complete authorized live migration or publication.

Acceptance should exercise harmless owned targets, permission denial, duplicate/conflicting sends, reply correlation, late replies, crash/reconnect, uncertain outcomes and actual exit. Record versions, evidence date and observed results separately from documentation/interface claims. Preserve private runtime evidence outside public source.

## Historical v0.4 Docker/HTTP evidence

The previous candidate recorded **58 tests**: 28 service, 16 waiter, one native queue and 13 legacy tests. A packaged-container rehearsal covered fresh install/reuse, occupied-port rejection, three synthetic registrations, discovery, direct mail, completion and unlink; backup/restore was also exercised. The real two-harness reinstall was incomplete. These counts and results do not validate v0.5 or lift current policy blocks.

## Historical v0.3 Docker/HTTP evidence

The previous release recorded **52 tests**: 22 service, 16 waiter, one table-driven native queue and 13 legacy export/import tests. Coverage included scoped authentication, fenced claims, pauses, notification reservations, bounded attendance, direct receiving, WAL backup, quarantined restore and import provenance/deduplication.

Earlier native CLI checks demonstrated HTTP send/claim/complete and limited session-owned notification paths. A peer-reported Claude native message demonstrated one delivery path, not the new combined no-persist adapter. Session-bound notification evidence does not prove unattended startup or app-closed wake. Historical migration/recovery evidence does not authorize a new cutover.
