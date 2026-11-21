# Validation

## 1.3.0 one-off remote processing

The release suite passed **160 checks**: 90 service, 16 legacy waiter, 32 CLI/help/resolver/listener/update, 13 legacy import and 9 installer. The official MCP SDK fixture covers the new operation and rejects foreign sources and unsupported permissions. Worker tests cover no target sessions, durable correlation, duplicate prevention, changed-input conflicts, revoked/denied peers, native defaults, read-only arguments, policy-probe failure and actual answer extraction. Existing timeout/cancellation/uncertainty and retention tests remain in place.

A live Windows Codex CLI test through a fresh isolated installation registered the harness, invoked the new CLI/MCP route without a recipient, started one ephemeral worker in the default install folder, returned its exact answer, reused the same durable job on retry and acknowledged the result. A direct native test also passed. Effective native MCP servers were disabled by the worker policy probe; authentication and enforced native rules were retained. All 27 affected native-adapter/installer checks also passed on Windows, and the installed skill passed structural validation.

Claude command/result handling is fixture-tested. No live Claude inference was performed for this release because the account's weekly allowance was exhausted. Live Claude completion, native Linux/macOS execution and other harness adapters are not claimed as validated. One-off write access is deliberately unsupported; existing-session messaging remains separate.


## 1.2.6 automatic suspended-chat wake

All **156 checks passed** across the release suite and affected reruns: 87 service, 16 legacy waiter, 32 CLI/help/resolver/listener/update, 13 legacy import and 8 installer. The initial installer run caught a stale version assertion; it now compares against the package version, and all eight installer checks passed on Linux and Windows. Twenty-nine updater/resolver/help checks passed on Windows; the final wake/help cases also passed on Linux.

On Windows Claude Desktop 5.11492.5.0 and CLI 2.1.296, an existing non-archived test target was confirmed unloaded by the desktop API and absent from live discovery. The actual `resolve` CLI, run with a host PTY, automatically found its current desktop metadata, opened its exact existing CLI UUID, and verified the same desktop ID, name and cwd through fresh discovery. Its first harmless request returned a correlated reply from that original chat. The user did not open the target or run a command. No replacement chat or test archive was created.

Fixtures cover zero live sessions, bootstrapping one existing relay, duplicate/changed identities, archived/remote/malformed state, missing PTY, already-running targets, interrupted/uncertain opens and the durable one-attempt journal. Earlier live testing also opened an existing chat after every Claude process had been stopped; the final zero-live orchestration is fixture-tested, while the final native automatic test used an unloaded target with another chat already running. macOS and Linux native opening, app-closed delivery and future desktop metadata layouts are not claimed as validated.

Claude reviewed the interface distinction and native metadata requirements before its allowance ran low. Subsequent implementation and tests ran locally in Codex. Native desktop metadata is an undocumented, read-only compatibility input; incompatible layouts stop without opening a guessed target.

## 1.2.5 linked skills and native health

The final pinned-container suite passed **151 tests** (87 service, 16 legacy waiter, 27 CLI/help/resolver/listener/update, 13 legacy import, 8 installer). Eighteen updater/help checks and eight packaged installer checks passed separately on Windows.

A real update of a 1.2.3 installation stopped safely before activation because the shared skill was a directory link into the verified app package. The updater now recognises that exact owned target, preserves the link and updates its canonical file with the package. Other unexpected links remain rejected. A Windows/Linux regression test covers this layout.

The read-only `harness.health` tool identifies the process actually serving a native connection, allowing agents to distinguish an old connection from the newly installed runtime. Fresh-client health and native-host health are separate checks.

On 15 November 2026, the managed updater successfully upgraded a live Windows installation from 1.2.3 to the published 1.2.5 package. Fresh MCP health reported 1.2.5, the database integrity check passed, shared skill links remained intact, and a subsequent update check reported current. Existing credentials, registrations and unrelated MCP settings were preserved. The downloaded archive matched GitHub's published SHA-256 digest.

Both open native chats could still discover peers, and Claude returned a correlated verification reply. Their existing tool catalogues did not expose the new health tool, so native serving-version verification remains pending reconnect. Codex's supported reload endpoint was unavailable (Windows error 10050); the updater reported the restart requirement and did not restart either app. This validates installation and continued communication, not automatic refresh of every open chat.


## 1.2.4 managed updates

The full pinned-container suite passed **150 tests** (87 service, 16 legacy waiter, 26 CLI/help/resolver/listener/update, 13 legacy import, 8 installer). Windows updater/help checks passed separately after adding ACL preservation; all eight Windows packaged installer checks also passed. Targeted follow-up checks cover the final archive-path and CLI-help changes.

Updater fixtures exercise read-only checks, compatible activation, preservation of database bytes/credentials/settings, semantic versions, checksums and safe archive paths, local-edit refusal, active-worker/concurrent-update refusal, rollback at staging/activation/health failure, recovery of an interrupted transaction, and bounded native reload outcomes. The installed package was compared with the published release before attempting a real update. These checks do not equate a fresh SDK connection or a reload acknowledgement with every open chat refreshing its native tools. App restarts require user approval.


## 1.2.3 quiet delivery

The full pinned-container suite passed **135 tests** (87 service, 16 legacy waiter, 11 CLI/help/resolver/listener, 13 legacy import, 8 installer). Extended SDK and registry tests cover real tool-result replies, source isolation, attendance before send, bounded waits, listener renewal without claiming, pending grace, expiry fallback, pause/cancellation/revocation, invalid-request cleanup and the short native notification. The listener wrapper tests exercise internal renewal and cleanup without model calls. All eight packaged installer tests also passed on Windows, and the skill validator passed.

A live Windows Claude–Codex test used the deployed 1.2.3 runtime. The existing Claude session started the listener through its own native background Bash task. The next request returned `receiver_attending` instead of dispatching a user-message notification. Claude reported a native system task-completion event with exit code 0, claimed the request and returned the correlated proof. Its reply arrived in the caller's waiting MCP result with no extra Codex notification. Both test replies were completed and the bounded listener exited without re-arming. No replacement chats or desktop capture were used.

The Codex test used the bundled SDK client inside a shell tool because the existing native MCP connection was closed during upgrade. A supported app-server reload attempt could not reach the local control socket (Windows error 10050). Fresh SDK connections expose all four new tools; this does **not** prove that already-open Codex tool catalogues refreshed. Those need a successful native reconnect. Tool expansion/collapse remains host-controlled. Idle Codex queue delivery is still a brief visible notification; there is no verified hidden idle wake API.


## 1.2.2 target resolution and setup checks

The full pinned-container suite passed: **131 tests** (85 service, 16 legacy waiter, 9 queue/help/resolver, 13 legacy import, 8 installer). The six resolver tests cover direct delivery, one verified desktop relay, stale/ambiguous/unsupported discovery, identity changes after wake, retry suppression, malformed input and bounded native registration metadata. Existing help tests also cover the new command. The Windows installer checks passed separately before this change; the final full installer run was in Linux containers.

Live Windows checks established the actual Claude boundary: a nonpersistent CLI helper could not list an unloaded desktop target, and an explicit native `SendMessage` to its exact name failed as unreachable. `--desktop` refused a prompt. Native messaging from a desktop-hosted session then woke the existing target, which acknowledged receipt over IHCP3K without doing project work or creating a chat. The desktop identity stayed the same while its native process UUID changed. The new resolver subsequently found that live target by name and project.

The offline wake was exercised through the same request/notification/native-desktop components used by the resolver, before adding the CLI orchestration. It was not a fresh-install rehearsal of the final packaged command against an unloaded target. Do not describe these component checks as proof that a standalone CLI can wake every offline chat or start a closed app. At least one reachable desktop session with native session-management tools is required.

Setup now reuses verified local packages and keeps lifecycle/destructive tests out of ordinary installation. Local chat coordination continues through native harness tools; IHCP3K handles cross-harness requests and explicit protocol operations.


This page distinguishes automated tests from checks performed in real agent applications. A **fixture** is controlled test data or a simulated app response; a **rehearsal** exercises a specific real workflow. Neither proves compatibility with every app version. Technical terms are defined in [terminology](terminology.md).

## Version 1.5.1: post-update model refresh

The pinned Docker suite passed all 165 tests. The managed-update fixture verifies that a failed catalogue refresh leaves the new runtime installed and that repeat invocations respect the catalogue cache. The model-only discovery fixture verifies that refresh updates the catalogue without scanning sessions or changing the last session scan time.

## Version 1.5.0: notification recovery and automatic Codex model discovery

The pinned Docker release suite passed **165 tests** (95 service, 16 waiter, 32 CLI/update/resolution, 13 legacy import, 9 packaged installer). Regression checks cover a child that returns the final page but never exits, a proven native launch failure versus ambiguous delivery, catalogue additions/removals, expiry and failed probes, shared probe fencing and operator configuration retries without local mirror writes. The managed-update checks cover interruption, rollback and reconnect reporting using fixtures.

A read-only Windows probe against installed Codex CLI `0.171.0-alpha.13` resolved the registered Windows package, discovered 135 sessions, and read 11 advertised models including GPT-6.2 Sol. Model access stays advisory. Starting a second MCP client for verification does not establish that an already-running chat has reconnected.

## Version 1.4.0: native app updates and retained inboxes

The pinned Docker release suite passed **164 tests**: 94 service, 16 waiter, 32 command/update/resolution checks, 13 legacy import and 9 packaged installer checks. Existing tests were extended for revision-checked configuration, credential/claim/address preservation, real SDK operator permissions, retained inbox/reply access, stale-send rejection, native catalogue pagination and package-family resolution. No existing behavior checks were removed. The desktop-opener/update checks were also rerun directly after connecting the shared executable resolver (27 passed).

A read-only Windows development check against Codex CLI `0.171.0-alpha.13` resolved the installed package family, discovered 129 non-archived native sessions and obtained 11 catalogue models using only initialization and paginated `model/list`. This establishes the installed interfaces, not model execution entitlement or closed-app delivery. The old versioned executable was absent. Live installation repair and native reconnection remain separate observations recorded privately after release.

The build exposed a pre-existing cookie-signature lockfile entry naming unpublished 1.2.6; both locks now identify published 1.2.2, whose registry integrity matches the already-recorded hash. Dependency installation and bundling ran only in the pinned Docker environment.

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
