# Validation

This page distinguishes automated tests from checks performed in real agent applications. A **fixture** is controlled test data or a simulated app response; a **rehearsal** exercises a specific real workflow. Neither proves compatibility with every app version. Technical terms are defined in [terminology](terminology.md).

## Version 1.2.1: automatic notifications

The full suite passed **125 tests** (85 service, 16 legacy waiter, 3 queue/help, 13 legacy import, 8 installer); the eight packaged installer checks also passed on Windows after the version bump. Added coverage checks automatic Codex notification configuration, rejected incomplete Claude configuration, and unique UUID-to-native-registration resolution, including missing and duplicate bindings.

An installed Windows Claude–Codex round trip was observed: the runtime notified an idle Claude session, which claimed and replied through its native MCP tools without a human reminder. The reply generated a native queue notification that arrived in the original Codex chat. Claude reconnected its MCP tools without a manual reload. Codex's existing tool connection remained closed after the runtime update; its bundled local MCP client successfully handled the reply. The skill documents this temporary transport fallback. This proves notification delivery in that installed workflow, not closed-app wake or universal client reconnection.

## Version 1.2.0: bounded retention

The full rebuilt suite passed **124 tests** (84 service, 16 legacy waiter, 3 queue/help, 13 legacy import, 8 installer). New tests cover complete request/reply deletion without dangling links, pending and uncertain preservation, finite duplicate prevention, inactive referenced sessions, acknowledged versus uncertain worker history, capacity rejection with atomic rollback, and a real SQLite reader blocking WAL checkpointing. Targeted retention tests also passed on Windows. This release uses the harness-first public command `/remote_prompt Claude Ask the review agent to do ABC`; native routing still requires an available unambiguous destination.

## Version 1.1.1: one-question setup

Setup asks only “Where do you want to install it?” The agent chooses the internal layout and native registration details. Omitting `peers` now enables reciprocal communication with existing and future registered harnesses in the same private installation; explicit existing restrictions remain enforced.

All **121 automated tests** pass across the full-suite run and the corrected installer-version assertion rerun. Existing registry/MCP tests now register without peer lists, exercise later harness joins and retain restriction/revocation checks. The eight packaged installer checks also pass on Windows. The skill validator and local Markdown links pass. These checks validate the implementation and instructions, not an unobserved native installation or a guarantee that every agent follows the guide. Native permission prompts remain controlled by each harness.

## Version 1.1.0: harness registration

The rebuilt 1.1.0 bundles passed **121 automated tests**: 81 service, 16 legacy waiter, 3 queue/command-help, 13 legacy import and 8 installer checks. New cases cover registration reuse, automatic new/missing session discovery, stable addresses, reciprocal permissions, explicit source-session isolation, whole-harness revocation, fresh credentials on relink, failed scans, competing process leases and offline restore. Official MCP SDK clients exercise the new tools and worker ownership. Native command fixtures cover pagination, malformed listings, timeouts and unsupported adapters. The eight packaged installer checks also passed separately on Windows Node 24.15.0.

Read-only discovery also passed against the installed Windows Codex and Claude executables. Codex returned unarchived thread metadata; Claude returned the live sessions exposed by `agents --json`. No transcripts were read or model tasks started. Codex's isolated inventory process reported `notLoaded`; that is not evidence that the corresponding desktop sessions are inactive.

This validates discovery, not a completed fresh native installation or end-to-end delivery under the new harness registration. Claude notification targeting must be checked with the exact IDs returned by its listing; the historical short-reference delivery below does not prove that. Historical Claude chats omitted by the native listing and automatic Copilot discovery are not supported by these adapters. The user will run the actual installation acceptance steps in [agent setup](../AGENT_SETUP.md).

## Version 1.0.0 — 14 November 2026

The full automated suite passed against freshly rebuilt 1.0.0 bundles: **108 tests** (69 service, 16 legacy waiter, 3 queue/command-help, 13 legacy import and 7 installer checks). The two new help tests exercise every CLI mode, missing arguments, explicit help, unknown options and aliases. The existing installer workflow now exercises `remote_prompt`, its compatibility aliases and `unregister`, verifying that revoked sessions cannot discover peers and another session remains usable.

The same seven installer checks also passed on Windows with Node 24.15.0; this is a platform rerun, not seven additional unique tests.

All current Markdown files were reviewed for unexplained terminology; local documentation/image links and the mock SVG's XML were checked. The README conversation is illustrative, not evidence of a native UI test.

The 1.0.0 name is a product-version change, not a claim of broader harness coverage. Native autocomplete is not implemented. Harness-wide unregister is a skill-guided workflow; automated tests cover the one-session CLI revocation, not native settings removal across every harness. The real Claude–Codex evidence below was collected during the earlier development release and was not repeated for this documentation/CLI update.

## v0.5 experimental prerelease

The tests below distinguish working transport from remaining native behavior gaps. An existing production installation was not migrated during this validation. No clean end-to-end native installation is implied by local tests.

Validation completed on 14 November 2026 against the candidate source and freshly built bundles:

- Full service suite: **69 passed**, including 13 experimental AHP transport fixtures.
- Legacy Claude waiter: **16 passed**; native queue fixture: **1 passed**; legacy import adapter: **13 passed**.
- Local installer: **7 passed** in Docker. Total across these suites: **106 passed**.
- The same **7 installer tests passed on Windows**, including protected ACLs, strict reuse, offline import, SDK stdio connections and a synthetic request/reply workflow. This is a platform rerun, not seven additional unique behaviors. Windows backup flushes require a writable file handle; that failure was fixed and the affected tests rerun.
- Claude's source review closed with no remaining material blockers after concurrency and shutdown fixes. It did not independently rerun the suites or validate real Copilot hosts.

Coverage includes cross-process deduplication/fencing, bounded waiter leases and throttled presence writes, rollback after process death, atomic correlated replies, failed/late worker result persistence, cleanup gating and restore with paused mail/revoked registered credentials. SQLite's native busy retry is bounded to five seconds; transaction callbacks are not replayed on contention. General maintenance intentionally retains a one-minute cadence. These are implementation checks, not proof of a native model doing work or receiving a message notification.

Public-source checks found no private path/session identifiers or matches against the installation's private credential files. Repository author/committer email history uses the GitHub noreply identity. These checks do not constitute a security audit.

## Native behavior still pending

An isolated two-harness rehearsal on 14 November 2026 used the committed v0.5 bundles and a fresh Windows runtime:

- Fresh installation, separate endpoint registration and reciprocal discovery passed.
- Both test sessions exchanged correlated requests/replies through scoped SDK stdio clients; both replies were matched and completed.
- Claude reported successful native stdio directory discovery and mailbox inspection in a no-persist CLI invocation with a private MCP configuration. Persistent native configuration was not changed.
- Codex CLI `0.167.0-alpha.4.1` loaded the MCP tools but refused discovery/status under headless approval policy `never`. A user-approved retry with a two-tool allow list and per-tool approval overrides returned the same error. The reason those overrides were ineffective remains unresolved.
- The subsequent interactive Codex test **passed**: the user approved the two inspection tools separately in the native terminal, and both returned actual MCP results. The directory contained both proof endpoints; mailbox status showed two completed messages. The receiving session verified the terminal output. This validates native loading and inspection, not unattended headless grants or approval of message-writing/worker tools.
- The exact restricted Claude notification command then passed from the chosen working folder with no permission denials and observed child exit; the recipient independently confirmed delivery. Matching an inaccessible desktop UUID first stopped safely; the verified native listing reference succeeded.
- Both notification adapters were then enabled only on the isolated runtime. A new correlated request automatically notified Claude, which claimed and replied. Its reply returned a successful Codex queue acknowledgement; the Codex session claimed and completed the correlated reply. The expected queued message notification subsequently appeared in the busy receiving conversation. This observed delivery does not prove unloaded/app-closed behavior or a general delivery-time guarantee.
- Both isolated endpoints were subsequently unlinked at revision 2 with no pending mail. Operator inspection confirmed the Codex endpoint inactive; Claude reported its own inactive result. Original test sessions and production state were retained.

See [native setup](native-setup.md) for the tested scope and first-use approval procedure. The existing mailbox stayed live; this rehearsal did not migrate or delete production state.

New native adapter execution is fixture/mock-tested beyond the earlier receiving-session evidence. No current end-to-end claim is made for:

- Claude delivery across idle/busy/unavailable or duplicate-name targets beyond the single verified target and exact-ref rehearsal above.
- Codex queue delivery on the owning server across idle/busy/unloaded states; warning handling is distinct from target consumption.
- Native worker result parsing, cancellation, child exit, ambient MCP/hook restrictions and descendant/remote-task ownership on the installed versions.
- Codex archive/delete effects, exact worker identity, acknowledgement gating and delayed cleanup after restart. Command presence is not proof of erasure.
- Copilot experimental worker results or live AHP access to an existing owning host/session. Documented routes remain untested and may need changes.
- Native configuration reload, concurrent-chat endpoint bindings and harness-specific stdio process ownership. No one-process-per-chat guarantee is assumed.
- App-closed delivery, unattended startup or a complete production migration.

Acceptance should exercise harmless owned targets, permission denial, duplicate/conflicting sends, reply correlation, late replies, crash/reconnect, uncertain outcomes and actual exit. Record versions, evidence date and observed results separately from documentation/interface claims. Preserve private runtime evidence outside public source.

## Historical v0.4 Docker/HTTP evidence

The previous candidate recorded **58 tests**: 28 service, 16 waiter, one native queue and 13 legacy tests. A packaged-container rehearsal covered fresh install/reuse, occupied-port rejection, three synthetic registrations, discovery, direct mail, completion and unlink; backup/restore was also exercised. The real two-harness reinstall was incomplete. These counts and results do not validate v0.5 or establish current native setup permissions.

## Historical v0.3 Docker/HTTP evidence

The previous release recorded **52 tests**: 22 service, 16 waiter, one table-driven native queue and 13 legacy export/import tests. Coverage included scoped authentication, fenced claims, pauses, notification reservations, bounded attendance, direct receiving, WAL backup, quarantined restore and import provenance/deduplication.

Earlier native CLI checks demonstrated HTTP send/claim/complete and limited session-owned notification paths. A peer-reported Claude native message demonstrated one delivery path, not the new combined no-persist adapter. Session-bound notification evidence does not prove unattended startup or delivery while the app is closed. Historical migration/recovery evidence does not authorize a new cutover.
