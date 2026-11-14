# Agent setup and operation

For an installing agent: a **harness** is the app running the assistant. IHCP3K exposes tools through **MCP (Model Context Protocol)**. Its default **stdio** connection passes messages through a local process's standard input and output. A registered **endpoint** is a session's IHCP3K address; its **binding** records the actual app, host and session behind that address. The private runtime folder holds the database, configuration and credentials. See the [terminology reference](docs/terminology.md) for other implementation terms.

This guide installs **IHCP3K 1.0.0** from scratch. It requires no previous session, mailbox or installation. See `docs/validation.md` for measured results and remaining limitations. Native setup and cutover require explicit scope and installed-version validation. Never bypass an app or tool execution denial.

## First install: ask before writing

Ask the user to choose the **private runtime folder before creating state**. Record that choice; on relink, show and reuse it unless the user selects migration. Do not infer a destination from the checkout, current directory, another harness or this guide's examples. Keep credentials, native IDs, databases, results and account evidence out of public source. A deliberately selected Git-ignored private subfolder is possible; it must never enter commits or exported artifacts.

Record the user-chosen working folder separately. `--workdir` stores it as `runtime.working_directory`; it defaults to the private folder when that is the same choice. Temporary notification processes run there. The target keeps its own registered working folder; substantive task workers use their separately approved adapter cwd.

Also establish:

- The participating harnesses, actual CLI and desktop-engine versions, host/server ownership and exact native session bindings. Titles are labels, not identities.
- Selectable models, access and allowance evidence, source and observation date. Inventory interfaces without inference first; keep unknowns unknown.
- Effective native privileges, permitted peers, executable and working directory, explicit model and bounded execution limits.
- Worker history: result only/no-persist where supported, or supported native archive/delete with an optional retention period. Explain unavailable choices before enabling a worker.
- User-chosen shared skill and agent-definition locations and project memory locations. Reuse existing sources; do not make separately edited harness copies.

Keep the inventory in private operator records, with peer-visible observations in the endpoint profile and identity details in its private binding. Registration does not discover these facts automatically. Sessions communicate directly; ordinary prompts remain local.

## Install from a release in a new session

1. Ask where the user wants the source/bundle files and **separate private runtime state**. Neither folder needs to be a previous installation. Do not reuse credentials or earlier session memories.
2. Download `IHCP3K-1.0.0.zip` and `IHCP3K-1.0.0.zip.sha256` from [the v1.0.0 release](https://github.com/GreyManSoftware/IHCP3K/releases/tag/v1.0.0). Verify the ZIP SHA-256 against the checksum before extracting into the chosen code folder. These assets include both runtime bundles; the GitHub-generated source archives do not.
3. Check existing Node is 24.15+; do not install missing software without following the user's environment policy. With this ZIP, no npm install or Docker build is needed.
4. From the extracted code folder, run `node scripts/install-local.mjs <chosen-private-directory> --workdir <chosen-working-folder>`. The private directory must be new and its parent must exist. These are explicit absolute paths selected with the user, not literal placeholders.
5. Follow [onboarding](docs/onboarding.md) to enrol/register each endpoint, then [native setup](docs/native-setup.md) for the harness's scope and first-use approval. Test discovery, correlated mail, notification and unlink. Each receiving identity must remain scoped to its intended session.

For a source checkout without the prebuilt ZIP, use the build instructions below. A new or unknown harness must pass its own capability checks; do not infer support from the Claude–Codex rehearsal. Copilot is experimental and may require changes.

## Prerequisites and install

Use an **already installed Node 24.15+** runtime with the required SQLite support. The runtime checks SQLite 3.51.3+. Do not install Node, SDKs, CLIs or packages on the host. Missing prerequisites are a limitation to report, not permission to install software or select another paid account.

For source builds, `node scripts/dev.mjs prepare` installs dependencies and bundles the official MCP SDK in the pinned Docker image. Dependency and cache binaries stay in named Docker volumes. It produces `service/dist/stdio.mjs` and `service/dist/client.mjs`; there is no host `npm install` step. An already-built local installation does not need Docker running.

After the folder choice, follow [onboarding](docs/onboarding.md):

```sh
node scripts/install-local.mjs /absolute/private/ihcp --workdir /absolute/chosen/working-folder
```

All paths in examples are placeholders. Use the selected absolute path, with an existing parent directory. The installer creates private runtime configuration, credentials, copied bundles and SQLite state. An identical rerun with the same working-folder choice verifies and reuses the installation; it does not upgrade an old database, replace an incomplete installation or repair widened permissions silently. Keep administrator credentials out of model-facing MCP entries.

The optional [Docker/HTTP deployment](docs/http-v04.md) retains the existing v0.4 feature set. It is not a second authority for the same mail and does not expose the new stdio worker/request capabilities merely because it uses the same source tree.

## Register and prepare native configuration

Issue an operator-scoped, one-use enrolment for an exact endpoint and permitted peers. Register with the chosen runtime, private native binding and attributed profile; store separate session and wake credentials. Each receiving session uses its own session credential. See [onboarding](docs/onboarding.md) for commands and retry behavior.

Emit a native configuration snippet for the user's explicit setup step. Do not write native configuration, broaden permissions, restart an app or create a management chat as an installation side effect. Preserve unrelated native settings and record the scope/name of any entry the user explicitly chooses to install. A saved entry is not proof that a running session loaded it.

Follow the [native setup checks](docs/native-setup.md). Never put a session's receiving token in a user-global entry and claim other sessions remain isolated. First-use tool approval is separate from filesystem access; prove it under the installed harness rather than requiring a blanket permission bypass.

The stdio launch contract is:

```text
<existing-node-executable> <private-runtime>/bundles/stdio.mjs <private-runtime>/runtime.json <private-session>/session.tok
```

Only file paths, never token values, enter the arguments. Example Codex TOML:

```toml
[mcp_servers.ihcp]
command = "/absolute/path/to/node"
args = ["/absolute/private/ihcp/bundles/stdio.mjs", "/absolute/private/ihcp/runtime.json", "/absolute/private/session/session.tok"]
cwd = "/absolute/private/ihcp"
startup_timeout_sec = 15
tool_timeout_sec = 45
```

Example Claude Code entry inside its supported `mcpServers` configuration:

```json
{
  "ihcp": {
    "type": "stdio",
    "command": "/absolute/path/to/node",
    "args": ["/absolute/private/ihcp/bundles/stdio.mjs", "/absolute/private/ihcp/runtime.json", "/absolute/private/session/session.tok"],
    "cwd": "/absolute/private/ihcp"
  }
}
```

Verify the installed client's schema, scope, executable trust and actual tools. Desktop Code and CLI versions/configuration can differ. Do not apply Code-session guarantees to ordinary consumer chats. MCP process ownership is harness-dependent: one process is not necessarily one chat. Scope credentials accordingly and verify concurrent-session bindings before enabling delivery.

For an authorized operation without native tools, use the bundled SDK client against the same runtime:

```sh
node service/dist/client.mjs /absolute/private/ihcp/runtime.json /absolute/private/session/session.tok mail.status /absolute/private/status.json
```

The input contains `{"recipient":"alpha-main"}`. Claim output includes private bodies and claim tokens. A denied native action must not be retried through the helper to evade policy.

## Requests, notifications and workers

Use `mail.request`, `mail.reply` and `mail.request_status` for correlated requests. The service derives the return endpoint from the requester's credential; claimed replies identify the original request. `ihcp.mjs remote_prompt` sends a durable request and returns its ID, without waiting for completion or creating a worker. `mail.send` remains available for ordinary asynchronous messages.

Claim only your own inbox, verify current user authority, renew while working and complete with the current generation/token. Release unstarted work with `work_started:false`; possible effects require reconciliation. A message, catalogue entry or native notification is not permission to execute.

Configure notifications separately in trusted `runtime.notifications`, keyed by endpoint and fenced by `endpoint_revision`. An active runtime checks configured inboxes without AI polling or a central relay. Codex uses its native queue; Claude may use a bounded, validated native messaging worker. A queue acknowledgement is not consumption. Failed or ambiguous delivery must remain visible, never become an implicit replacement session. See [native adapters](docs/native-adapters.md).

In stdio, `mail.send`, `mail.request` and `mail.reply` commit first, then await the configured bounded notification before returning (`timeout_ms` capped at 30000, with bounded shutdown). The response includes `native_notification` dispatch status, never proof of target receipt. A one-shot CLI therefore attempts its configured notification before closing. Mail stays durable if notification fails; retry only with the original idempotency key. The active-runtime timer remains for pending recovery. Notifications are disabled until explicitly configured.

`worker.start/status/wait/ack` operate only on configured `runtime.workers` adapters with `allow_endpoints`. Callers cannot supply their own executable or override native privileges. Use `ihcp.mjs worker` for the CLI workflow: it keeps the stdio connection open until the result or its wait limit. A one-shot `worker.start` call followed by closing that connection aborts its owned child; it does not detach a job. Inspect and preserve the result before explicit acknowledgement.

For active inbox waits, register `mail.attend` before sending, use bounded `mail.wait`, and release with `mail.unattend` in cleanup. Attendance lasts at most 120 seconds and must not be renewed after ending a turn. It suppresses only new message notifications, and returned mail can be unrelated. The legacy `exchange` helper uses ordinary `mail.send`, not the new correlation protocol.

## Retention and process ownership

Prefer native no-persist for result-only workers when supported by the validated version. Native history, durable protocol results, process lifetime, worktrees, artifacts, logs and backups are distinct. No-persist and native delete do not promise zero residue or remote erasure.

This version implements archive/delete only for persisted **Codex workers**, with explicit cleanup permission. Cleanup needs an acknowledged durable successful result, verified child exit and the exact owned worker ID. Retain failed, active or uncertain jobs for reconciliation. Never target the requester/recipient session, delete raw transcripts or use a project-wide purge for worker cleanup. Observing the immediate child exit does not prove every descendant or remote task stopped.

A retention period records a terminal action and due time. Cleanup is opportunistic while a runtime is active, or on later activity; N hours is not an exact execution deadline. There is no implicitly installed scheduler or daemon. Worker result records are not automatically erased by native cleanup.

## Validation, migration and recovery

Record measured results separately from interface inspection or documentation claims. Before advertising support, verify scope denial, duplicate/conflicting requests, correlated replies, reconnect/concurrent stdio behavior, worker cancellation/exit, and installed-version idle/busy/unavailable target delivery. See [validation](docs/validation.md). Do not run real work merely to probe capabilities.

Installation and migration are separate operations. The optional `install-local.mjs <new-private-directory> <offline-backup.db> <sha256> [--workdir <chosen-working-folder>]` form restores a verified offline snapshot into a new private root with fresh service identity, revoked registered credentials, disabled endpoints and paused unresolved mail. It does not modify the source, configure native clients, unpause mail or switch live authority. Freeze old writers, take a consistent offline snapshot/backup, reconcile uncertain effects, then choose one authority explicitly. Do not point old HTTP and new stdio runtimes at the same live database or dual-write two copies. See [migration](docs/migration.md) and [cutover](docs/cutover.md). The local installer does not create backups or perform live cutover.

Keep current state when restoring: newer messages/effects must be reconciled against a separate restored copy. Restored credentials require explicit relink. Never auto-fallback to a retired file mailbox. Backups have a separate retention choice and may retain old bodies.

## Unknown harnesses and shared knowledge

Negotiate capabilities per version and surface: MCP transport, credential scope, stable session/host identity, native notification, worker execution, cancellation, process ownership, persistence and cleanup. Label evidence as observed, documented-only, unsupported or unknown. Inspect native interfaces before using inference. Do not infer a live adapter from documented APIs alone.

Unknown harnesses start with scoped mail and manual checks. If live delivery cannot be established, leave durable mail pending with its limitation or return an explicit manual handoff. A new worker is a separate choice. Copilot is experimental. A documentation-based AHP notification adapter now exists, but actual installed-host access and behavior are untested and may need changes; manual fallback remains required when it cannot validate the target.

Keep shared skills, agent definitions and project memory in user-chosen locations. Native adapters reference those sources; IHCP3K does not sync them, duplicate memory or replicate sessions. Handovers require a checkpoint, source stop, destination verification and explicit acceptance. Peer silence never transfers ownership.
