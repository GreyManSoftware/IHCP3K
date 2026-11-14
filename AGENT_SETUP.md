# Agent setup and operation

Install **IHCP3K 1.1.0** by registering each harness once. A harness is an agent application and its local account/profile, such as this Codex installation. Native sessions are discovered automatically; do not ask users to enrol every chat.

## First install

1. Ask for a code/bundle folder and a **separate private runtime folder** before writing state. Record the choices. Other harnesses join the same runtime; do not create a second database for them.
2. Download `IHCP3K-1.1.0.zip` and its `.sha256` file from [the release](https://github.com/GreyManSoftware/IHCP3K/releases/tag/v1.1.0). Verify the hash. GitHub source archives do not contain the prebuilt bundles.
3. Use existing Node 24.15+ (SQLite 3.51.3+). Follow the user's installation policy if prerequisites are missing. The prebuilt ZIP needs no npm install or Docker at runtime. Source builds use pinned Docker via `node scripts/dev.mjs prepare`.
4. Ask for the working folder used by helper processes, independently of the private folder. Run:

```sh
node scripts/install-local.mjs /absolute/private/ihcp --workdir /absolute/chosen/work-folder
```

All paths are placeholders. Use the user's selected absolute paths; the parent of the private folder must exist. This creates private credentials, configuration and the database, but does not modify native app settings or reconnect another harness. Matching installer reuse is read-only. Older installations need an explicit offline restore/migration, not an in-place overwrite.

## Register one harness

Record a unique harness instance ID, installed version, exact executable and native account/profile being inventoried. Two computers or separate accounts are distinct harness instances even if both use Codex. Select the permitted peer harness IDs with the user; peer permission must be reciprocal. Record the models available to this harness, their evidence/date, and any observed usage. Model listings do not grant permission to spend or dispatch.

The supported automatic discovery adapters are:

- **Codex:** `codex app-server --stdio`, using read-only `thread/list` with pagination, non-archived threads and state-database-only metadata. It does not read message history or start/resume a thread. Status comes from this inventory connection and is not proof of the desktop session's live status. A deliberately configured `transport:"proxy"` uses the running app-server proxy; there is no silent fallback between routes.
- **Claude:** `claude agents --json`, listing the interactive/background sessions exposed by that installed CLI. Closed historical chats not exposed by this command are not invented or inferred from transcript files.
- **Other harnesses:** automatic discovery is not yet implemented. Report the missing adapter; do not present manual per-session registration as a successful harness-wide install. Copilot's earlier experimental notification code does not establish discovery support.

Prepare a private configuration (replace every placeholder):

```json
{
  "harness": "codex-local",
  "peers": ["claude-local"],
  "discovery": {
    "type": "codex",
    "executable": "/absolute/path/to/codex",
    "cwd": "/absolute/chosen/work-folder",
    "timeout_ms": 15000,
    "max_sessions": 10000
  },
  "profile": {
    "label": "Codex on this computer",
    "source": "Installed native interfaces checked during setup",
    "observed_at": "2026-01-01T00:00:00Z",
    "fresh_for_s": 3600,
    "models": [],
    "usage": [],
    "wake": {
      "type": "manual",
      "lifetime": "Until a notification adapter is validated",
      "closed_app": "unknown",
      "human_fallback": "Open the target and check its inbox"
    }
  }
}
```

Use the real observation time. Obtain model and usage field definitions from [the protocol](docs/protocol.md); preserve unknowns rather than invent entitlements. For Claude use `type:"claude"` and its installed executable. Executables must be absolute paths, not shell wrappers or commands supplied by another agent.

```sh
node scripts/ihcp.mjs register /absolute/private/ihcp/runtime.json /absolute/private/codex-config.json /absolute/private/codex
```

The operator credential authorizes this one registration. The result includes a native MCP launch configuration; the harness folder contains `harness.json`, private retry data and `harness.tok`. Registration immediately attempts a native inventory and returns its status separately. A discovery error means setup is not complete even though the credential was stored; fix the adapter and refresh. An identical retry reuses the registration. Changed settings require explicit review/re-registration, not silent overwrite. Do not expose the administrator credential to ordinary sessions.

## Connect the harness once

Install the returned MCP configuration in the **chosen harness-wide scope**, after reviewing the actual app's supported settings and obtaining any required native approval. Preserve other servers. The launch is:

```text
<existing-node> <private-runtime>/bundles/stdio.mjs <private-runtime>/runtime.json <private-harness>/harness.tok
```

The token intentionally authorizes the harness, not one chat. Every mail operation supplies its exact source `session_id`; the server checks that it belongs to this harness's discovered inventory. Never set a connection-wide “current session”, because multiple chats can share one MCP process. Never put one per-session credential into the global entry.

Use the app's reliable current-session metadata to identify the caller. Match an exact native ID from discovery, not a title or the most recently active chat. If the app cannot expose its current ID, ask the user to choose the source from the discovered sessions. This selects an identity; it is not another registration. Same-harness clients share trust and can act as that harness's sessions; this is not isolation against malicious clients using the same credential or OS account.

Existing chats may need a native configuration reload. Do not restart apps or broaden permissions silently. New chats use the same harness configuration and need no new IHCP3K token or enrolment.

## Discovery, requests and replies

Call `harness.discover` or `node scripts/ihcp.mjs discover <harness-dir>`. It refreshes the permitted harness inventories, returning stable session addresses, native IDs, labels, working folders and observed state. Successful snapshots are cached for 15 seconds; `/refresh` forces a rescan. Discovery and outgoing requests trigger refresh; there is no AI polling or permanently installed discovery service.

A complete successful scan adds new sessions and disables missing ones. Failed or partial scans retain the last inventory with an explicit error/stale flag; they do not authorize sending against that failed scan. A label is for display, not routing. Use the exact returned address.

For a request, call `session.request` with `session_id`, `recipient`, `body`, and a stable `idempotency_key`. The source ID may be its native ID or its discovered address; the destination must be the exact discovered address. The returned request ID tracks the reply. Receivers use `session.claim`, `session.reply` and `session.complete`, always identifying their own source session. Help for every CLI mode is available with `--help`; see [usage](docs/usage.md).

Do not send work just because a model or session appears in discovery. User authorization, selected model and native permissions still apply.

## Notifications and optional workers

Registration/discovery does not prove that a receiving chat has read a message. Configure and validate notifications **once per harness**. An optional top-level `notification` template in the registration configuration is inherited by discovered sessions, with exact native IDs filled by the service; users do not register notification targets individually.

For Codex the template is `{"enabled":true,"type":"codex-queue"}`. For Claude it is a validated `claude-message` template with explicit model, `verified:true` and bounded turns. The Claude route must support the exact IDs returned by `agents --json`; older short-reference-only native listings may fail to match. Never set `verified:true` without checking the installed route. Missing/ambiguous targets leave mail pending; do not substitute a new chat or a title match. See [native adapters](docs/native-adapters.md).

Explicit task workers remain optional. Configure trusted executable/model/limits and `allow_harnesses:["codex-local"]` for harness-wide permission, or a narrower `allow_endpoints` list. Use the `session.worker_*` tools or CLI `worker` with `session_id` in its input. The owning connection must remain open; shutdown cancels owned workers. Review and acknowledge successful results before configured cleanup. Native cleanup is currently implemented only for opted-in persisted Codex workers, with verified exit and exact identity. No guarantees of zero logs or secure erasure.

## Unregister and test

`/unregister <harness>` invokes `harness.unregister`: it revokes the harness credential and every discovered session address atomically, without deleting shared messages or other harnesses. The agent then removes only that harness's recorded IHCP3K native settings using its supported settings mechanism. Resolve active work and stop only verified owned helpers; report any incomplete settings removal. Relinking restores the stable session addresses: retained pending mail becomes available again, while uncertain claims remain for review. Inspect retained work before re-enabling notifications or handling requests.

Before calling setup complete, test: register once; discover multiple sessions; create another native session and discover it without registering again; exchange a harmless correlated request/reply between two sessions; confirm replies cannot be claimed using another source session; unregister one harness and confirm the other still works. Native configuration, notifications and full app behavior require their own observations. See [validation](docs/validation.md).

## Shared knowledge and unknown harnesses

Keep one user-chosen shared source for skills/agent definitions and project-scoped memory. IHCP3K does not copy chat history or merge memories. A handover requires a checkpoint, source stop and destination acceptance.

For an unknown harness, implement and test a bounded read-only session-discovery adapter first, including stable IDs, pagination, disappearance, failure handling and account/host scope. Then validate native MCP configuration, source-session identity, notification and permissions. Do not promise support based solely on an advertised MCP interface or silently fall back to manual session enrolment.
