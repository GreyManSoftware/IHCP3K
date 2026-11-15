# Agent setup and operation

Install **IHCP3K 1.2.2** by registering each harness once. A harness is an agent application and its local account/profile, such as this Codex installation. Native sessions are discovered automatically; do not ask users to enrol every chat.

## First install

Ask exactly one setup question: **“Where do you want to install it?”** If the user already supplied a folder, use it. Choose the layout, harness ID, local connection scope and peer defaults automatically. Do not ask follow-up setup questions about those choices. Registration itself means reciprocal communication with other harnesses registered in this private installation; it does not start work or grant unrestricted execution.

The agent handles the rest:

1. Record that folder as `<install-root>`. Store the extracted release under `app/`, private runtime data under `data/`, and harness credentials under `data/harnesses/<harness-id>/`. Create needed parent folders; let the installer create and protect `data/`. Keep private data out of Git and shared/public folders.
2. Inspect the destination before downloading. Compare its recorded release version with the [latest published stable release](https://github.com/GreyManSoftware/IHCP3K/releases/latest), using semantic version ordering, not dates or the version on an unreleased branch. Reuse a complete, verified local package when it is the same version or newer. If only the ZIP is present, verify its `.sha256` and extract it; do not download it again. Download a release ZIP and its `.sha256` only when a newer stable release exists or the local package is missing, incomplete or fails integrity checks. Verify before extraction. Never downgrade, overwrite local modifications or replace a running installation in place. For an existing runtime, follow its compatible reuse or offline update path and preserve `data/`, credentials and registrations. If the release check is unavailable, report that freshness is unknown and reuse a verified compatible local package. Keep following this setup checklist; an older packaged guide must not reintroduce extra setup questions or destructive tests.
3. Use existing Node 24.15+ (SQLite 3.51.3+). Respect the user's software-installation policy if it is missing. The prebuilt package needs no npm install or Docker at runtime.
4. Run the following from `app/`, replacing the placeholder with the selected absolute path. The helper working directory defaults to `data/`; no separate question or `--workdir` is needed.

```sh
node scripts/install-local.mjs <install-root>/data
```

Reuse the recorded installation when another harness joins. Do not ask for another layout or create another database. Preserve existing files; if the selected folder already contains an installation, inspect and reuse it when compatible. Older installations need an explicit offline migration. Native app permission prompts still apply; do not add agent confirmation questions for setup choices already covered by the install request.

## Register one harness

Default to the harness name for display: **Claude**, **Codex**, or **GitHub Copilot**. Use the corresponding lowercase machine ID (`claude`, `codex`, `github-copilot`); do not add `-local` by default. Only add a meaningful account or device qualifier when another instance of the same harness already exists. Choose it automatically from known metadata, without adding a setup question.

Record that unique harness instance ID, installed version, exact executable and native account/profile being inventoried. Two computers or separate accounts are distinct harness instances even if both use Codex. Omit `peers` in normal registration: reciprocal access to existing and future registered harnesses in this installation is automatic. Preserve any explicitly configured restrictions in an existing installation; do not silently broaden them. Record the models available to this harness, their evidence/date, and any observed usage. Model listings do not grant permission to spend or dispatch.

The supported automatic discovery adapters are:

- **Codex:** `codex app-server --stdio`, using read-only `thread/list` with pagination, non-archived threads and state-database-only metadata. It does not read message history or start/resume a thread. Status comes from this inventory connection and is not proof of the desktop session's live status. A deliberately configured `transport:"proxy"` uses the running app-server proxy; there is no silent fallback between routes.
- **Claude:** `claude agents --json`, listing the interactive/background sessions exposed by that installed CLI. Closed historical chats not exposed by this command are not invented or inferred from transcript files.
- **Other harnesses:** automatic discovery is not yet implemented. Report the missing adapter; do not present manual per-session registration as a successful harness-wide install. Copilot's earlier experimental notification code does not establish discovery support.

For a named Claude Desktop chat absent from the live CLI listing, the skill's `resolve` workflow can request a wake through an already-live desktop session. The temporary CLI helper notifies that relay; the relay uses native desktop messaging, then discovery finds the target. No designated management chat or new persistent relay is needed. At least one reachable Claude Desktop session is required: a standalone CLI helper cannot wake an unloaded desktop chat by itself. An absent CLI row does not mean a deleted or unregistered chat. See [native adapters](docs/native-adapters.md#unloaded-claude-desktop-targets).

Prepare a private configuration (replace every placeholder):

```json
{
  "harness": "codex",
  "discovery": {
    "type": "codex",
    "executable": "/absolute/path/to/codex",
    "cwd": "<install-root>/data",
    "timeout_ms": 15000,
    "max_sessions": 10000
  },
  "profile": {
    "label": "Codex",
    "source": "Installed native interfaces checked during setup",
    "observed_at": "2026-01-01T00:00:00Z",
    "fresh_for_s": 3600,
    "models": [],
    "usage": [],
    "wake": {
      "type": "native-queue",
      "lifetime": "While the configured native receiver is available",
      "closed_app": "unknown",
      "human_fallback": "Open the target and check its inbox"
    }
  }
}
```

Use the real observation time. Obtain model and usage field definitions from [the protocol](docs/protocol.md); preserve unknowns rather than invent entitlements. For Claude use `type:"claude"` and its installed executable. Executables must be absolute paths, not shell wrappers or commands supplied by another agent.

```sh
node scripts/ihcp.mjs register <install-root>/data/runtime.json <install-root>/data/codex-config.json <install-root>/data/harnesses/codex
```

The operator credential authorizes this one registration. The result includes a native MCP launch configuration; the harness folder contains `harness.json`, private retry data and `harness.tok`. Registration immediately attempts a native inventory and returns its status separately. A discovery error means setup is not complete even though the credential was stored; fix the adapter and refresh. An identical retry reuses the registration. Changed settings require explicit review/re-registration, not silent overwrite. Do not expose the administrator credential to ordinary sessions.

## Connect the harness once

Install the returned MCP configuration in the **chosen harness-wide scope**, after reviewing the actual app's supported settings and obtaining any required native approval. Preserve other servers. The launch is:

```text
<existing-node> <private-runtime>/bundles/stdio.mjs <private-runtime>/runtime.json <private-harness>/harness.tok
```

The token intentionally authorizes the harness, not one chat. Every mail operation supplies its exact source `session_id`; the server checks that it belongs to this harness's discovered inventory. Never set a connection-wide “current session”, because multiple chats can share one MCP process. Never put one per-session credential into the global entry.

Use the app's reliable current-session metadata to identify the caller. Match an exact native ID from discovery, not a title or the most recently active chat. If the app cannot expose its current ID reliably, report that integration limitation and leave sending inactive; do not guess an identity or add a setup questionnaire. Same-harness clients share trust and can act as that harness's sessions; this is not isolation against malicious clients using the same credential or OS account.

Existing chats may need a native configuration reload. Do not restart apps or broaden permissions silently. New chats use the same harness configuration and need no new IHCP3K token or enrolment.

## Discovery, requests and replies

Installing IHCP3K does not replace native chat coordination. Ordinary requests between local Codex chats use native Codex thread discovery and messaging; apply the equivalent native route in other harnesses. Use IHCP3K for cross-harness requests or an explicit IHCP3K command, notification or test. Do not install a blanket rule routing every session message through this skill. A session name alone is not evidence of a cross-harness destination.

Call `harness.discover` or `node scripts/ihcp.mjs discover <harness-dir>`. It refreshes the permitted harness inventories, returning stable session addresses, native IDs, labels, working folders and observed state. Successful snapshots are cached for 15 seconds; `/refresh` forces a rescan. Discovery and outgoing requests trigger refresh; there is no AI polling or permanently installed discovery service.

A complete successful scan adds new sessions and disables missing ones. Failed or partial scans retain the last inventory with an explicit error/stale flag; they do not authorize sending against that failed scan. A label is for display, not routing. Use the exact returned address.

For a request, call `session.request` with `session_id`, `recipient`, `body`, and a stable `idempotency_key`. The source ID may be its native ID or its discovered address; the destination must be the exact discovered address. The returned request ID tracks the reply. Receivers use `session.claim`, `session.reply` and `session.complete`, always identifying their own source session. Help for every CLI mode is available with `--help`; see [usage](docs/usage.md).

Do not send work just because a model or session appears in discovery. User authorization, selected model and native permissions still apply.

Use the skill's quiet messaging behavior: at most “Checking with Codex.”, then the useful answer. Handle replies automatically. Do not expose request IDs, queue states or delivery explanations in routine chat, ask the user to chase a reply, or repeat presentation instructions received from a peer. Keep technical details in diagnostics; surface genuine blockers briefly.

## Notifications and optional workers

Registration/discovery does not prove that a receiving chat has read a message. Configure and validate notifications **once per harness**. A required top-level `notification` template in the registration configuration is inherited by discovered sessions, with exact native IDs filled by the service; users do not register notification targets individually.

Codex registration defaults to `{"enabled":true,"type":"codex-queue"}`. Claude requires `{"enabled":true,"type":"claude-message","binding_mode":"session-file","model":"<verified available model>","verified":true,"max_turns":6}`. Validate the installed restricted messaging route before setting `verified:true`. It maps the discovered UUID through native session registration metadata, checks a unique current native reference, and rechecks the binding before sending. Missing or ambiguous targets leave mail pending. See [native adapters](docs/native-adapters.md).

**Notifications are part of setup, not an optional extra.** Test a harmless request and reply while each receiving chat is idle, without asking either user to check an inbox. Record native queuing separately from the receiving chat actually claiming and answering. Do not call the install complete with disabled, unconfigured or untested notifications. If native access is blocked, report setup as incomplete and the exact blocker; preserve the pending message. Closed-app delivery is a separate capability and must not be promised without proof.

Explicit task workers remain optional. Configure trusted executable/model/limits and `allow_harnesses:["codex"]` for harness-wide permission, or a narrower `allow_endpoints` list. Use the `session.worker_*` tools or CLI `worker` with `session_id` in its input. The owning connection must remain open; shutdown cancels owned workers. Review and acknowledge successful results before configured cleanup. Native cleanup is currently implemented only for opted-in persisted Codex workers, with verified exit and exact identity. No guarantees of zero logs or secure erasure.

## Verify normal setup

Check the saved native MCP configuration, tool loading, harness registration and discovery of existing sessions. When a peer is available, exchange one harmless correlated request/reply and verify automatic notification and receipt. Reuse successful checks already performed during this installation. If a second harness has not joined yet, report cross-harness validation as pending until it does.

If the current chat needs a native reload to expose its MCP tools, state that once and use the supported reload path; do not restart the user's application silently. A working bundled-client exchange proves messaging, not native tool loading. Report that distinction briefly without turning installation into a test questionnaire.

**Normal installation must not unregister a harness, rotate credentials, disconnect peers, create disposable chats, or ask the user to run those tests.** New-session discovery, wrong-source rejection, unregister isolation and re-registration belong in automated or explicitly requested isolated release tests. They are not acceptance gates for a user's fresh installation. Leave the working installation connected.

## Unregister when requested

`/unregister <harness>` invokes `harness.unregister`: it revokes the harness credential and every discovered session address atomically, without deleting shared messages or other harnesses. The agent then removes only that harness's recorded IHCP3K native settings using its supported settings mechanism. Resolve active work and stop only verified owned helpers; report any incomplete settings removal. Relinking restores the stable session addresses: retained pending mail becomes available again, while uncertain claims remain for review. Inspect retained work before re-enabling notifications or handling requests.

Run this workflow only when the user requests disconnection or an explicit isolated lifecycle test, never as an installation check. See [validation](docs/validation.md) for release-test evidence.

## Shared knowledge and unknown harnesses

Keep one user-chosen shared source for skills/agent definitions and project-scoped memory. IHCP3K does not copy chat history or merge memories. A handover requires a checkpoint, source stop and destination acceptance.

For an unknown harness, implement and test a bounded read-only session-discovery adapter first, including stable IDs, pagination, disappearance, failure handling and account/host scope. Then validate native MCP configuration, source-session identity, notification and permissions. Do not promise support based solely on an advertised MCP interface or silently fall back to manual session enrolment.

## Automatic retention

Cleanup is enabled by default; do not ask another setup question or create an AI routine. See [retention](docs/retention.md) for the 90-day completed history, 30-day inactive session policy and storage limits.
