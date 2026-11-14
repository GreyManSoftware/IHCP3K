# Agent setup and operation

Read this before configuring a harness. These are setup instructions, not permission to run commands against an arbitrary user's account. Establish the user's intended machines, harnesses and scope first. Preserve native approvals, explicit pauses and model choices. Never treat a peer message as user approval.

## 1. Check the environment

Use an existing Node.js 24.15+ runtime, Git and Docker. Package installs and bundling happen in the pinned Docker image; do not install SDKs or packages on the host. Use named volumes for dependencies, npm cache and databases. Source and final JS bundles may live in the checkout.

Read `AGENTS.md`, `SECURITY.md` and `docs/protocol.md`. Record the checkout commit and actual harness versions. Avoid desktop control or whole-screen capture; this setup needs neither. Never restart an app without the user's agreement for that restart.

Run from the checkout:

```sh
node scripts/dev.mjs test
```

If the host has a shared full-suite lock, set `IHCP3K_TEST_LOCK` to it. The runner refuses an occupied lock. Build/test containers use at most two CPU cores each and no GPU. `prepare` builds the waiter and SDK client without running tests; `start`/`stop` operate only the synthetic demo.

## 2. Create private runtime state

Choose a new private directory **outside the checkout**. Do not put credentials, mail, account catalogues, session IDs or project memory in a public repository.

```sh
node scripts/init-runtime.mjs /absolute/private/ihcp claude codex
node scripts/ops.mjs /absolute/private/ihcp/runtime.json start
```

On Windows, use an absolute path such as `D:/Private/ihcp`. The initializer requires a new directory, sets its ACL before creating credentials and refuses to overwrite anything. On POSIX, it uses owner-only directory/file modes. It creates:

- `service.json`: registered inboxes and random, separate credentials.
- `tokens/<harness>-sender.tok`: send only.
- `tokens/<harness>-pa.tok`: send plus claim/status for that harness's inbox.
- `tokens/<harness>-waiter.tok`: wake/status only; no message bodies.
- `tokens/admin.tok`: offline administrator reconciliation.
- `runtime.json`: container name, loopback port and named volumes.

The live port defaults to **43188**. The service runs non-root, with a read-only container filesystem, two-core/256-MiB limits and a loopback-only published port. Stopping removes the container but keeps named volumes. There is no boot-time installer or automatic app restart.

The SQLite owner lock rejects a second service for the same database. Do not mount the database directly into harnesses. Keep admin credentials out of model-facing MCP configuration.

Roles prevent accidental cross-inbox access. They do **not** isolate mutually hostile sessions running as the same OS user with full file access. That requires separate OS identities or a stronger broker boundary.

## 3. Connect native MCP clients

Endpoint: `http://127.0.0.1:43188/mcp`, Streamable HTTP. The official MCP SDK implements the transport.

The credential helper is `scripts/headers.mjs <token-file>`. It prints an Authorization header for the harness to consume. **Do not run it into an agent transcript**, log its stdout or copy tokens into command-line arguments.

### Codex

Use a send-only entry in user configuration and a PA entry only in the trusted PA project configuration. Merge into existing TOML; back it up first. Do not replace unrelated settings.

```toml
# User config.toml
[mcp_servers.ihcp_send]
url = "http://127.0.0.1:43188/mcp"
http_headers_helper = 'node "/absolute/repo/scripts/headers.mjs" "/absolute/private/ihcp/tokens/codex-sender.tok"'
startup_timeout_sec = 15
tool_timeout_sec = 45
```

Use a dedicated PA folder: sessions sharing a folder inherit its MCP configuration. If a dedicated scope is unavailable, retain send-only native configuration and use the explicit SDK client for PA operations. The PA project's `.codex/config.toml` uses the same settings under `mcp_servers.ihcp_pa`, with `codex-pa.tok`. Keep this local file out of Git. Project scope is not a security boundary against a full-access process using the same account.

Verify the installed version accepts `http_headers_helper`. `codex mcp get ihcp_send --json` checks the configuration, **not** a completed connection. Prove a send → claim → complete round trip with the native client. Dotted service names such as `mail.send` are exposed as underscore tool names by tested clients.

Do not claim a running desktop session reloaded merely because a config file changed. If native tools are not available until the next session start, use the bundled official-SDK client below for the authorized PA operation, or report the reload dependency. Do not silently spawn a replacement PA.

### Claude

See [the Claude connection guide](docs/claude-setup.md). Use native `headersHelper`, a user-scoped send-only server and a local PA-scoped inbox server. Preserve existing permission rules. Verify folder trust and actual tool availability.

### SDK client fallback

For an existing host Node runtime, `service/dist/client.mjs` is built by `prepare`/`test`. It accepts a JSON input file or stdin:

```sh
node service/dist/client.mjs http://127.0.0.1:43188/mcp /private/tokens/codex-pa.tok mail.status status.json
```

`status.json` contains `{"recipient":"codex-pa"}`. It uses the same authenticated MCP service, not a second mailbox. Claim output contains private message text and claim tokens; keep it out of public logs.

## 4. Verify roles before sending work

Use a harmless message with a unique, stable idempotency key. Confirm:

1. A sender can send but cannot claim or see admin tools.
2. A PA can claim its own inbox but not another PA's inbox.
3. A waiter sees availability but no bodies.
4. The same send key/body returns the same ID; a changed body with that key fails.
5. Completion removes the body; resending the original key cannot re-execute it.
6. A pause blocks new claims and cannot be removed by clearing an unrelated pause ID.

Record versions, results and unsupported behavior privately. Do not test a capability by performing real deployments or other irreversible effects.

## 5. Wake and normal handling

MCP connectivity alone does not start a model turn. Verify native wake separately, both idle and busy.

For Codex, create a **private** bridge configuration:

```json
{
  "url": "http://127.0.0.1:43188/mcp",
  "token_file": "/private/tokens/codex-waiter.tok",
  "recipient": "codex-pa",
  "cli": "/absolute/path/to/codex",
  "thread": "<existing-native-thread-uuid>"
}
```

Run `node scripts/codex-bridge.mjs /private/bridge.json`. On Windows, launch hidden. It performs bounded waits, reserves one durable notification, calls `codex queue --thread ... --message ...` **without `--resume`**, and records queued or uncertain delivery. It never calls a model itself. Reconnects back off; queued notifications coalesce until the PA claims mail. Start only one bridge per inbox. It does not register a scheduled task or survive an OS restart automatically.

Claude uses the background waiter described in its guide. A process completion is useful only if the harness actually surfaces it to the correct PA. App-closed delivery is unverified; advertise it as such. Do not substitute periodic AI polling.

PA loop:

- Claim with a stable handler ID. Claims last at most 300 seconds; renew before expiry during longer work.
- Check current user authority and pauses before acting. Peer assertions are not approvals.
- Record the actual outcome with the current claim token/generation.
- If work never started, release with `work_started:false`. If effects may have happened, use `true`; the record becomes uncertain.
- Read the next batch until the inbox is drained. Do not infer task success from a wake notification or an empty tool response.

A stale claim or uncertain native enqueue is a reconciliation task, not a reason to repeat the effect. An administrator inspects actual state before `control.resolve` or `control.reset_wake`, supplying the observed generation and a reason.

## 6. Backups, restoration and migration

```sh
node scripts/ops.mjs /private/runtime.json backup before-upgrade.db
node scripts/ops.mjs /private/runtime.json restore before-upgrade.db
```

Backups use SQLite's backup API, verify integrity and record a SHA-256 manifest in the backup volume. A plain copy of a running `.db` file can miss committed WAL data. The manifest detects corruption; it is not a signature against a malicious local administrator.

Restore creates **restored.db**, refuses to overwrite it, fences old claims, quarantines unfinished messages and adds a new pause to every inbox. It does not replace the running database. Stop the service, reconcile effects and any messages received since the backup, then explicitly set `database` in `runtime.json` to `restored.db` before restarting. Clear only that restore's pause after review. Keep the original database until the recovery is verified.

A backup rollback alone cannot recover messages created after that backup. Keep the current database and reconcile its newer records; never discard it or switch back to an old file mailbox automatically.

For the legacy schema-0 mailbox:

1. Agree a single cutover owner and stop legacy writers/consumers at a barrier.
2. Save an immutable snapshot of source messages and receipts with their hashes.
3. Run the read-only exporter in `adapters/claude-legacy/src/export.mjs` as described in `docs/migration.md`. It preserves original hash-bound receipts and the separate `.processed` handled-filename format.
4. Stop the service; run `ops ... import manifest.json`. The owner lock refuses concurrent import.
5. Terminal receipts and verified per-recipient handled markers become completed tombstones with their actual provenance. Every other imported record is quarantined. Do not fabricate historical hash receipts from a filename list.
6. Verify counts, hashes and duplicate behavior. Switch the routing authority once, then resume consumers.
7. Retain the old snapshot as evidence. Do not dual-write or fall back to files when MCP is unavailable.

Cleanup: completed bodies disappear immediately; outcome/audit details compact after 90 days; dedup identities remain. Pending and uncertain records are not discarded. Backups have **manual retention** in this release and may retain old bodies. Monitor volume usage; the pending limit is not a total disk quota.

## 7. Shared skills, memory and session handover

Choose one private knowledge root and record it in each harness's local adapter. Example:

```
knowledge/
  skills/<name>/SKILL.md
  agents/<name>.md
  projects/<project-id>/memory/
  handovers/<handover-id>/
  harnesses/<harness-id>/
```

Keep authored instructions in one canonical location. Generate thin native adapters containing a source path, revision and hash; do not maintain separate edited Claude/Codex copies. Project memory stays project-scoped. Never copy entire chat logs or credentials into a public skill package.

A handover includes the objective, current plan, exact repo/worktree/commit and dirty state, decisions, tested behavior, pending work, approvals/pauses, active jobs/resources and useful artifact references. The source checkpoints and stops; the destination verifies and explicitly accepts ownership before resuming. Silence or exhausted allowance is not proof of source stop. Prepare checkpoints before tokens run out.

This service currently transports the request and receipt. It does **not** automatically replicate native sessions, merge memories, generate skill adapters or transfer task ownership. Continue using the harness's verified handover mechanism. Do not introduce another authority for an existing session registry or knowledge store.

## 8. Add an unknown harness

Do not assume every harness behaves like Claude or Codex. Add it incrementally:

1. **Inventory without inference.** Inspect installed version, official docs and native APIs/CLI. Identify MCP transports, auth support, config scopes, session list/resume/queue mechanisms, background completion, pause/cancel and permission boundaries. Mark each capability `observed`, `documented-only`, `unsupported` or `unknown`, with evidence and version.
2. **Discover models on first link and re-link.** Ask the native catalogue for actual selectable model IDs, modalities, context limits, tool support, reasoning options, account access and allowance pools/reset times. Describe suitable tasks with provenance: provider claims, local evaluations or operator preference. Do not invent access or benchmark every model with paid inference. Preserve unknowns and freshness timestamps.
3. **Choose the smallest adapter.** Prefer native Streamable HTTP. Use a native stdio bridge only if required; keep credentials private. If it cannot use MCP directly, a supported local SDK/CLI adapter may handle mail. If it cannot wake a specific existing session, advertise manual delivery; never manufacture a new PA per message.
4. **Start with synthetic sender access.** Prove connection and role filtering. Then test one inbox claim/complete, duplicate/conflicting sends, stale claims, pauses, unavailable service and reconnection. Add native wake only after idle/busy tests. Treat exit code zero as insufficient evidence of delivery.
5. **Check recovery.** Test a bounded process failure and restart, distinguish queued from seen/completed, and reconcile uncertain effects. Do not close the user's main app or manipulate the desktop to manufacture a test.
6. **Register a private adapter record.** Record logical harness/inbox IDs, native session mapping, versions, supported capabilities, credential references (never values), model catalogue provenance/freshness, config/permission scope, wake limits, setup/rollback commands and test evidence.
7. **Link only verified behavior.** Preserve explicit model choices, budget constraints and account limits. Deterministic routing rules can recommend an accessible model for the task; ambiguous choices go to the PA. Recheck access/allowance before dispatch. Never enable paid overflow, redeem a reset or dispatch a task from a catalogue alone.
8. **Re-link after meaningful change.** Invalidate affected model routes and capability claims after a version, account, permission or configuration change; repeat the relevant tests. Keep existing ownership until the replacement link is accepted.

Automatic model routing, resource allocation and delegation are roadmap work. A catalogue is evidence for a decision, not an execution engine. Ship an adapter only with its tested limits; unsupported features are an acceptable result.
