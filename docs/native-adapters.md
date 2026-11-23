# Native adapters and retention

## One-off harness workers

`session.remote_prompt` derives trusted settings from reciprocal harness registration; callers cannot supply executables or native arguments. Claude runs `-p` with Read/Glob/Grep, strict empty MCP configuration, disabled hooks/skills and no session persistence. Codex runs `exec --sandbox read-only --ephemeral` after inspecting effective configuration for the working folder and disabling every MCP server, hooks, plugins, apps and delegation. Authentication and enforced rules stay native; no global settings, trust grants or credentials are copied. Unknown interfaces or MCP names that cannot be safely expressed as native override paths fail closed. This policy probe does not invoke a model.

Explicit model choices are preserved; omitted models use the native default. The adapter returns the actual Claude result/Codex final agent message. Timeout, incomplete output or unverified termination remains uncertain. Write permissions and paid/model fallback are unsupported. Nonpersistent does not promise zero logs or remote retention. Custom `runtime.workers` entries retain their operator-review requirements.

Native references: [Codex configuration](https://developers.openai.com/codex/config-reference/) and [Claude CLI](https://code.claude.com/docs/en/cli-reference). Installed behavior is validated separately in the release report.

An **adapter** connects IHCP3K to an app's own commands. A **notification adapter** tells an existing session that a message is waiting. A **task worker** starts a separate, time-limited session to do explicitly requested work. **Retention** controls how long a worker's chat history is kept. An **endpoint revision** is a registration version used to reject outdated target mappings. See [terminology](terminology.md) for configuration terms.

**v1.5.4; native coverage is listed in the validation report.** These adapters are used by the local stdio runtime. Docker/HTTP remains the separate v0.4 compatibility path.

A request to an existing session and a new worker are different operations. `remote_prompt` sends durable mail; the configured adapter notifies the existing target. `worker` explicitly creates a separately owned session to do a bounded task. Delivery failure must not silently substitute a worker or resumed session.

## Harness-wide discovery and notification setup

Version 1.1 registers a harness once. Codex's read-only [`thread/list`](https://learn.chatgpt.com/docs/app-server) and Claude's `agents --json` provide automatic session inventories; new sessions need no per-session credentials. See [agent setup](../AGENT_SETUP.md) for supported scope and limits.

A required `notification` template in the private harness registration is inherited by discovered sessions. The runtime fills the exact native ID and current session revision. Codex templates use `codex-queue`; Claude templates use `claude-message` only after validating support for the discovery listing's exact IDs. A previous test with a different short reference does not establish that support. Unsupported targets leave messages pending, rather than prompting per-session registration or silently starting another chat.

The explicit `runtime.notifications` maps below remain available for legacy/manual adapter configuration. They are not required for registering every newly discovered session. Worker configuration may allow an entire registered harness with `allow_harnesses`, with source-specific results still isolated by the explicit session identity.

## Quiet delivery and native UI limits

`session.exchange` and `session.wait` hold a real MCP call open and return received mail in its result. SQLite attendance suppresses new native notifications for that inbox while the call waits. The host decides how its tool results render or collapse; IHCP3K never injects fake tool-history entries.

For a Claude session with native background Bash tasks, the target can run `ihcp.mjs listen` as its own task. The non-AI wrapper renews attendance over bounded waits and exits on pending mail. The native task-completion event wakes that existing owner, which claims the inbox and handles it. It does not create a relay chat, require another registration, or install an OS service. A detached process launched elsewhere cannot supply a target-owned completion event. See the skill for re-arming and cleanup.

Codex's inspected `queue` / `thread/queue/add` interfaces have no hidden-user-message option. Idle fallback remains the brief `[IHCP3K] New message.`. The app-server's per-client notification filtering does not hide user turns in the desktop, and raw history injection is not a supported substitute for a wake or an actual tool result. See the [app-server interface](https://learn.chatgpt.com/docs/app-server). Already queued notifications cannot be recalled.

A listener holds at most a 120-second renewable lease, shortened to 15 seconds when it reports mail. Expiry restores ordinary notification eligibility if the owner fails to claim. Outstanding queued/uncertain notifications remain subject to normal reconciliation. Stop a listener before another wait/exchange in that inbox; overlapping receivers fail with `INBOX_ATTENDED`. Native permission prompts remain unchanged.

## Trusted configuration

Only operator-owned `runtime.json` selects executables, working directories, models, permissions, targets, persistence and limits. Directory profiles, bindings, mail and model output cannot supply executable configuration. Use an existing absolute native executable, not a shell or `.cmd`/`.bat`/`.ps1` wrapper. No host runtime installation, automatic account/model switching or paid fallback is implied.

For process-based adapters, common fields are `enabled:true`, `type`, absolute `executable`, absolute `cwd`, explicit `model`, `permissions:"read-only"`, `persist`, `timeout_ms`, `max_output_bytes`, `kill_grace_ms` and `max_turns`. A worker prompt does not override them. Configured limits bound the process, not every possible remote effect.

**Notification cwd defaults to the installation’s private `data/` folder (`runtime.working_directory`).** The agent uses that default without asking another folder question. `--workdir` remains an advanced override for an explicitly requested custom setup. The stdio runtime forces notification configs to that cwd; an adapter entry cannot change it. A temporary notification process runs there. The target continues in its own registered working folder; notification does not rewrite it. An explicitly requested task worker has its separately approved cwd.

## Notifications

`runtime.notifications` is a map from endpoint to trusted native adapter, including the endpoint's current `endpoint_revision`. The runtime checks pending mail while active, without AI polling. Reservations prevent competing runtime connections from blindly repeating a message notification. Refresh/relink increments endpoint revision; review the target and update the trusted mapping explicitly.

In stdio, `mail.send`, `mail.request` and `mail.reply` commit first, then await the configured bounded notification before returning (`timeout_ms` capped at 30000, with bounded shutdown). The response includes `native_notification` dispatch status, never proof of target receipt. A one-shot CLI therefore attempts its configured notification before closing. Mail stays durable if notification fails; retry only with the original idempotency key. The active-runtime timer remains for pending recovery. Fresh harness registration configures Codex notifications by default and requires a validated Claude template. Notification receipt must be tested before setup is called complete. Legacy per-endpoint notifications still require explicit configuration.

Illustrative Codex entry; replace all placeholders privately:

```json
{
  "notifications": {
    "beta-main": {
      "enabled": true,
      "endpoint_revision": 1,
      "type": "codex-queue",
      "executable": "/absolute/path/to/codex",
      "cwd": "/absolute/chosen/working-folder",
      "native_session_id": "<verified native UUID>",
      "resume": false,
      "persist": false,
      "timeout_ms": 30000,
      "max_output_bytes": 65536,
      "kill_grace_ms": 250
    }
  }
}
```

Codex uses `queue --thread ... --message ...` deterministically. It needs no model to send a notification. Record and verify the owning host/server, not just a UUID. `resume:true` is an explicit choice requiring validation of that server's unloaded-target behavior; successful exit with a warning is not proven delivery. A queue receipt establishes queuing only, never consumption or completion.

Claude uses `type:"claude-message"`, `verified:true`, `target:{"stable_id":"<verified identity>","native_hint":"<optional supporting hint>"}`, `persist:false`, an explicit model, `permissions:"read-only"` and bounded `max_turns`. It runs a throwaway `-p` worker allowed to use `Read,ListAgents,SendMessage`, with the adapter's strict MCP/hook/settings restrictions and no persistence. The exact combined **no-persist plus messaging** configuration must be validated on the installed CLI/desktop-engine versions before `verified:true` and enabling it. A successful worker result alone leaves target receipt unverified. Ordinary consumer chats are outside the verified Code-session route.

The notification prompt requests only an exact-target message notification. Missing/ambiguous targets stop delivery; display-name matches are insufficient. It must not perform the recipient's task, start a replacement chat or change the recipient's cwd.

For current Claude harness registration, set `binding_mode:"session-file"`. The runtime locates exactly one native `sessions/<pid>.json` record matching the UUID, without reading transcripts or messaging keys. The restricted helper validates UUID, PID, start time and name, resolves a unique native `ListAgents` reference, and rechecks that registration immediately before `SendMessage`. An optional trusted `sessions_directory` supports a non-default native registration directory. Missing, duplicate or changed bindings stop delivery.

Use an identifier the installed native listing actually exposes. In the Windows rehearsal, `ListAgents` exposed a short bracketed session reference, not the desktop's internal session UUID. The UUID attempt correctly stopped without sending; an independently verified exact reference succeeded with the full restricted flags. Record that reference's owning host and current session binding, and revalidate on relink. A title alone is not a substitute, and a reference is not guaranteed portable across hosts or future sessions.

If every runtime is closed, no timer runs. Short CLI calls do not leave a notification process behind. Missing native access leaves durable mail pending for an explicit manual check; uncertain dispatch needs reconciliation before reset. No scheduler, background service, screen automation or central relay is installed implicitly.

## Unloaded Claude Desktop targets

The temporary CLI notification helper uses `ListAgents`/`SendMessage`, which only expose reachable processes. Desktop sessions additionally have native session-management APIs that can wake unloaded chats. These are different interfaces; a successful notification-helper launch does not prove that a suspended target can be reached.

The agent runs `resolve` in a host-provided PTY, automatically:

1. Refresh the permitted native inventory; use an existing live target directly.
2. If absent, inspect bounded, read-only desktop session metadata for an exact name/project/optional desktop-ID match. Require a valid CLI UUID and desktop ID, `isArchived:false`, and no remote environment. Prefer explicit `envScopeId:builtin_local`. Older Desktop records omit the scope (and often the environment ID). Such a record qualifies only through per-chat evidence: its environment ID is null or absent, its origin folder (if recorded) matches its project folder, and either IHCP3K previously discovered that exact native UUID/name/folder for this request, or the private `data/desktop-evidence.json` holds a local sighting of that exact desktop ID with the same name, project and account folder. A sighting is recorded whenever resolution sees the chat live: a native registration on this machine (`~/.claude/sessions`, entrypoint `claude-desktop`) whose CLI UUID matches the Desktop record. It survives later CLI UUID rotation. A marked sibling, field names or an existing folder are never locality evidence. An explicit non-local scope or an environment origin is always rejected. A record without an explicit local scope never qualifies a bootstrap relay. A chat with no evidence yet goes through the exact native relay, whose follow-up resolution then records it. If the metadata scan hits its size limit, resolution reports `desktop_metadata_limit` (or `desktop_metadata:"limit"` alongside a relay request) rather than guessing. Reject ambiguous matches.
3. Recheck the file and native running inventory, then invoke only the registered Claude executable from the verified project folder with `--desktop --resume <existing-CLI-UUID>`. No prompt or replacement session is created. The command requires a PTY; the agent supplies it without asking the user to run a terminal command. App focus may change as the existing chat opens.
4. Rediscover and verify the current CLI UUID against the same desktop ID, name and cwd before sending the original request. If the native launcher exits uncertain, verify discovery within the same bounded attempt and do not relaunch. Opening is not delivery; require the correlated reply for completion.
5. If metadata cannot identify the target, use one verified live desktop session for native `list_sessions`/`get_session`/`send_message`. If none is running, first open one existing non-archived local desktop session from an unambiguous account using the same checks. Never chain relays or open a second bootstrap chat for the same attempt.

**Choosing the relay.** Any verified live Claude Desktop chat can relay, whatever its own project; the request tells it this is routine relay work and not to release it. By default the resolver prefers idle chats, then orders by address. An operator can set an optional preference in `data/runtime.json`: `"desktop_relay_preference": ["local_<uuid>", ...]`, a list of exact desktop IDs in priority order. It applies only among relays freshly verified for this attempt; an absent, archived, unverified or malformed entry is skipped and the default order applies. The preference never redirects an existing request; keep its original request ID and read its reply. Peer text, labels and titles cannot set it, and examples never ship a real ID.

**When the relay cannot help.** The relay answers with a correlated reply: `woken`, `not_found`, `ambiguous`, `unavailable` with a `reason` (for example paused, native tools unavailable or policy), or `uncertain` when a native send may already have happened. The requester reads that reply and reports it to its caller as the desktop relay's answer. It does not try another relay automatically: a fresh key could create a second live wake, and a released request returns to pending. `request_status` alone shows only the reply's ID and state, so it cannot certify a decline.

The exact desktop ID (`local_<uuid>`) differs from the CLI UUID. The live relay returns the target’s desktop ID; resolution checks its current native binding before sending work. Archived, deleted, remote/cloud, malformed and ambiguous metadata never authorizes an open. Native registration/configuration and permission failures are not bypassed.

**Compatibility:** the metadata layout is undocumented app state, accessed read-only, never modified. Windows Claude Desktop 5.11492.5.0 with CLI 2.1.296 was tested. The reader recognises the standard Windows and macOS locations; macOS native opening is not yet validated. Linux and unknown desktop layouts report unavailable. A source harness without a PTY cannot run this fallback. No transcript files, messaging keys or permission snapshots are exposed; only identity fields are used. A closed app may be launched by the native desktop-open command, but closed-app end-to-end behavior is not yet validated.

Before opening, a private journal reserves one attempt per source/harness/idempotency key. Concurrent retries coalesce; failed, interrupted or uncertain opens are not repeated automatically. Re-running resolution first checks whether the original target is now live. Journal cleanup is deterministic on use: 90-day retention and at most 1,000 records. Keep the original key; if its record has expired, inspect actual state rather than blindly replay. The journal is not a database migration or OS service.

A relay request can remain unread when a prior notification to its inbox is uncertain. The resolver returns the new request's notification status separately from the request ID. To change routes safely, the original sender can use `withdraw-wake` with the original resolve key and exact request ID. This only withdraws a never-claimed desktop relay request, including when an earlier notification was uncertain. It keeps the idempotency record and the inbox wake fence. A claimed or previously claimed relay requires reconciliation, not a retry under a new key.

No special PA session is required. The notification helper uses `--no-session-persistence` and exits, so there is no persistent throwaway chat to archive. Existing target and bootstrap chats remain intact.

## Task workers

`runtime.workers` maps an operator-chosen adapter name to trusted configuration. Each entry needs `allow_endpoints`. Example result-only Codex worker:

```json
{
  "workers": {
    "example-reader": {
      "enabled": true,
      "type": "codex-worker",
      "executable": "/absolute/path/to/codex",
      "cwd": "/absolute/approved/worker-folder",
      "model": "<verified selectable model>",
      "permissions": "read-only",
      "constraint_reviewed": true,
      "persist": false,
      "timeout_ms": 30000,
      "max_output_bytes": 65536,
      "kill_grace_ms": 250,
      "max_turns": 6,
      "allow_endpoints": ["alpha-main"],
      "retention": {"action": "none", "hours": 0}
    }
  }
}
```

Set the Codex configuration-review field only after reviewing effective native configuration, ambient MCP tools and hooks. Filesystem read-only sandboxing alone does not restrict those capabilities. The required gate is `constraint_reviewed:true`. Do not interpret this record as new permission or a substitute for effective native restrictions.

Codex workers use `exec --ephemeral` when `persist:false`. Claude workers use `type:"claude-worker"` and `-p --no-session-persistence` when nonpersistent; `max_turns` bounds Claude turns. Do not assume that field limits Codex turns: wall-clock/output limits are separate. Workers run with explicitly configured read-only privileges and an existing authenticated native installation. Installed versions must be validated; documented flags alone are not a behavior test.

`worker.start/status/wait/ack` persist job identity and bounded results. Only the launching runtime owns its child. The CLI `worker` helper keeps the stdio connection open through the result; one-shot `worker.start` followed by connection close aborts that child. A timeout or forced termination is uncertain even if the immediate child closes. Check status and reconcile instead of launching a duplicate job.

## Copilot boundary

An explicit `copilot-worker` experiment requires `experimental:true` and `persist:true`; a verified no-persist mode is unavailable in this adapter. It disables automatic updates/session syncing in its command, but that is not a no-history guarantee. The current output parser does not establish a verified Copilot terminal result, so output may remain uncertain. The documented CLI/SDK routes are untested here and may need version-specific changes.

This version includes a **documentation-based, experimental Agent Host Protocol (AHP) 1.1.0 notification adapter**, not a validated live integration. It uses an already configured owning host; it does not discover/start a host or create/resume a session. Installed-host access and behavior are untested and may need version-specific changes. Do not claim arbitrary running Copilot sessions are reachable.

Configure it under `runtime.notifications` with the endpoint revision, using operator-verified values:

```json
{
  "enabled": true,
  "experimental": true,
  "type": "copilot-ahp",
  "endpoint_revision": 1,
  "endpoint": "ws://127.0.0.1:43210/",
  "token_file": "/absolute/private/copilot-host-token",
  "protocol_version": "1.1.0",
  "session_uri": "ahp-session:/example-session",
  "chat_uri": "ahp-chat:/example-chat",
  "timeout_ms": 10000,
  "max_output_bytes": 262144,
  "close_grace_ms": 100
}
```

The sample endpoint/URIs are synthetic, not discovery defaults. Use the actual registered loopback WebSocket path and host-supplied URIs; never reconstruct them from a title or UUID. Only numeric loopback is supported, without DNS, tunnels or guessed paths. The bounded private token file contains only the connection token, not an account/provider credential or registry. No token is placed in public configuration examples.

This transport adapter needs no native executable/model and does not spawn a notification worker. It negotiates the configured protocol version, subscribes to the exact session/chat and verifies membership, then dispatches one queued pending-message action. A matching action echo establishes host queuing only; no consumption/completion is inferred. It does not answer permissions, supply tools, authenticate a provider, change model/cwd, dispose the target or reconnect/retry blindly. It disconnects only its own connection and reports whether close was observed.

If access, authentication, version or identity validation fails, leave mail pending and report the limitation. Use a manual handoff or an explicitly requested experimental new worker. Resume and window reuse are not substitutes for existing-session delivery.

## Choose retention during setup

| Choice | Supported behavior |
| --- | --- |
| Result only | Prefer verified native no-persist (`persist:false`), with `retention:{"action":"none","hours":0}`. The bounded protocol result/receipt remains. No promise of zero logs, artifacts or remote retention. |
| Keep history | `persist:true`, action `none`. No automatic native cleanup. |
| Archive | Persisted Codex worker only, explicit `cleanup:{"archive":true}` and retention action `archive`. Archive preserves history. |
| Delete | Persisted Codex worker only, explicit `cleanup:{"delete":true}` and retention action `delete`. Target only its exact recorded worker ID. |
| Retain N hours | Set `hours:N` with the chosen supported terminal action. Cleanup runs opportunistically while active or after next startup; it is not scheduled for an exact time. |

An operator may explicitly enable both Codex cleanup capabilities with `cleanup:{"archive":true,"delete":true}`; the configured retention action selects one. Claude/Copilot native archive/delete is not implemented in this version. Surface unsupported choices instead of silently substituting them.

Native cleanup requires a durable successful result, explicit result acknowledgement, verified child exit, exact owned worker identity and unchanged trusted configuration. Failed, running or uncertain jobs are retained for reconciliation. An acknowledged result does not by itself prove success or exit. Never clean up the requester/target chat, delete raw transcript files or purge a shared project.

Observed child exit does not guarantee descendant/remote-work termination. Native command success does not prove disk/remote erasure or worktree safety. Protocol result retention, native history, artifacts, worktrees and backups are separate concerns. Cleanup can wait for the next startup; no scheduler is needed or silently installed.

See [native app updates and retained inboxes](app-updates.md) for operator-pinned executable resolution, in-place configure/profile refresh, stale health and safe inbox access during failed discovery. Do not unregister or rotate credentials to repair a changed native executable.
