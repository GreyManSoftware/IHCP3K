# Native adapters and retention

An **adapter** connects IHCP3K to an app's own commands. A **notification adapter** tells an existing session that a message is waiting. A **task worker** starts a separate, time-limited session to do explicitly requested work. **Retention** controls how long a worker's chat history is kept. An **endpoint revision** is a registration version used to reject outdated target mappings. See [terminology](terminology.md) for configuration terms.

**v1.1.0; native coverage is listed in the validation report.** These adapters are used by the local stdio runtime. Docker/HTTP remains the separate v0.4 compatibility path.

A request to an existing session and a new worker are different operations. `remote_prompt` sends durable mail; the configured adapter notifies the existing target. `worker` explicitly creates a separately owned session to do a bounded task. Delivery failure must not silently substitute a worker or resumed session.

## Harness-wide discovery and notification setup

Version 1.1 registers a harness once. Codex's read-only [`thread/list`](https://learn.chatgpt.com/docs/app-server) and Claude's `agents --json` provide automatic session inventories; new sessions need no per-session credentials. See [agent setup](../AGENT_SETUP.md) for supported scope and limits.

An optional `notification` template in the private harness registration is inherited by discovered sessions. The runtime fills the exact native ID and current session revision. Codex templates use `codex-queue`; Claude templates use `claude-message` only after validating support for the discovery listing's exact IDs. A previous test with a different short reference does not establish that support. Unsupported targets leave messages pending, rather than prompting per-session registration or silently starting another chat.

The explicit `runtime.notifications` maps below remain available for legacy/manual adapter configuration. They are not required for registering every newly discovered session. Worker configuration may allow an entire registered harness with `allow_harnesses`, with source-specific results still isolated by the explicit session identity.

## Trusted configuration

Only operator-owned `runtime.json` selects executables, working directories, models, permissions, targets, persistence and limits. Directory profiles, bindings, mail and model output cannot supply executable configuration. Use an existing absolute native executable, not a shell or `.cmd`/`.bat`/`.ps1` wrapper. No host runtime installation, automatic account/model switching or paid fallback is implied.

For process-based adapters, common fields are `enabled:true`, `type`, absolute `executable`, absolute `cwd`, explicit `model`, `permissions:"read-only"`, `persist`, `timeout_ms`, `max_output_bytes`, `kill_grace_ms` and `max_turns`. A worker prompt does not override them. Configured limits bound the process, not every possible remote effect.

**Notification cwd is the user-chosen working folder (`runtime.working_directory`).** The installer records it with `--workdir`, defaulting to the private folder when that is the same choice. The stdio runtime forces notification configs to that cwd; an adapter entry cannot change it. A temporary notification process runs there. The target continues in its own registered working folder; notification does not rewrite it. An explicitly requested task worker has its separately approved cwd.

## Notifications

`runtime.notifications` is a map from endpoint to trusted native adapter, including the endpoint's current `endpoint_revision`. The runtime checks pending mail while active, without AI polling. Reservations prevent competing runtime connections from blindly repeating a message notification. Refresh/relink increments endpoint revision; review the target and update the trusted mapping explicitly.

In stdio, `mail.send`, `mail.request` and `mail.reply` commit first, then await the configured bounded notification before returning (`timeout_ms` capped at 30000, with bounded shutdown). The response includes `native_notification` dispatch status, never proof of target receipt. A one-shot CLI therefore attempts its configured notification before closing. Mail stays durable if notification fails; retry only with the original idempotency key. The active-runtime timer remains for pending recovery. Notifications are disabled until explicitly configured.

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

Use an identifier the installed native listing actually exposes. In the Windows rehearsal, `ListAgents` exposed a short bracketed session reference, not the desktop's internal session UUID. The UUID attempt correctly stopped without sending; an independently verified exact reference succeeded with the full restricted flags. Record that reference's owning host and current session binding, and revalidate on relink. A title alone is not a substitute, and a reference is not guaranteed portable across hosts or future sessions.

If every runtime is closed, no timer runs. Short CLI calls do not leave a notification process behind. Missing native access leaves durable mail pending for an explicit manual check; uncertain dispatch needs reconciliation before reset. No scheduler, background service, screen automation or central relay is installed implicitly.

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
