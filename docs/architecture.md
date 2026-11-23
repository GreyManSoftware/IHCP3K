# Architecture

IHCP3K connects sessions in different agent applications, called **harnesses**. Each harness registers once and supplies a read-only native session-discovery adapter. Sessions receive stable internal addresses automatically, without individual enrolment. Each uses **MCP (Model Context Protocol)** tools through a local IHCP3K process, or **runtime**. **Stdio** means that messages travel through that process's standard input/output, rather than a network server. SQLite stores requests and results in one private database. See [terminology](terminology.md) for the concurrency and lifecycle terms below.

**v1.5.3; see the validation report for tested behavior.** Native adapter behavior remains subject to installed-version validation. The default runtime is local MCP stdio using an existing Node runtime. Compatible runtime connections share one private SQLite database. The database is the coordination authority; process identity is not chat identity.

```mermaid
flowchart LR
  A["Harness session A<br/>shared harness credential"]
  B["Harness session B<br/>shared harness credential"]
  subgraph Local["Existing Node runtime processes"]
    R1["MCP stdio connection"]
    R2["MCP stdio connection"]
    N["Trusted notification adapters<br/>endpoint and revision binding"]
    W["Worker manager<br/>configured adapter and endpoint allowlist"]
    M["Maintenance while active<br/>no inference"]
  end
  DB[("Private SQLite WAL<br/>mail, directory, attendance,<br/>notifications, worker results")]
  Child["Bounded native worker<br/>separate owned session"]
  A <-->|"MCP tools"| R1
  B <-->|"MCP tools"| R2
  R1 <--> DB
  R2 <--> DB
  R1 --> N
  N <--> DB
  N -. "native message notification" .-> B
  R1 --> W
  W --> Child
  Child -->|result| W
  W <--> DB
  M <--> DB
```

The drawing shows logical components, not a guaranteed process count. Each stdio runtime has its own notification/worker managers and maintenance timers. Runtime clients may be shared or reused by a harness; credentials bind harnesses; every mail call identifies a source session from that harness’s inventory. Workers belong to the manager that launched them. Opening another connection does not adopt its children.

## State and concurrency

Schema 6 adds harness registrations, hashed harness credentials, discovered session metadata and cross-process scan leases. The shared schema also stores mail, scoped directory entries, hashed credentials, request/reply links, attendance leases, native notification reservations and worker results. WAL transactions serialize mutations. Claim generations/tokens, endpoint revisions and notification reservations fence stale operations. A short database lease coordinates general maintenance across runtime processes; worker cleanup reserves eligible rows transactionally.

Compatible v1.5.3 processes may share the database. A writer-version fence rejects incompatible writes. The older Docker/HTTP store uses an exclusive owner lock; it must not run against the shared local authority. Installer reuse checks identity, schema and copied-bundle integrity. Installation does not authorize an upgrade or live migration.

A committed message survives process shutdown. Expired claims and uncertain notification/worker outcomes require reconciliation; they do not silently replay. Opening another stdio connection must not invalidate a valid claim held elsewhere. A completed message clears its body but retains duplicate protection.

## Requests and receiving

`mail.request` commits a request with the caller's explicit return endpoint, derived from its credential, and a stable request ID. `mail.reply` uses the request's fenced claim to commit one correlated reply and complete the request atomically. Claimed replies carry `in_reply_to`; `mail.request_status` reports message and reply state. A completed request record alone is not proof of a successful task: inspect the reply and actual outcome.

Receivers either check their inbox or register bounded attendance before waiting. Attendance is persisted with a deadline so other runtime processes suppress new message notifications for that inbox. It does not renew itself, and starting another connection does not drop it. Already queued notifications cannot be recalled. Harness `session.exchange` establishes attendance before sending a correlated request and returns claimed messages inside its MCP result. `session.wait` continues receiving without resending. The legacy individually registered endpoint helper retains ordinary-send semantics. Both may receive unrelated mail.

## One-off processing

For authorized work without a destination chat, `session.remote_prompt` validates the source and target harness, then starts one headless Claude/Codex worker using the registered executable. This worker performs the task directly, so there is no notification relay. The owner connection receives a durable SQLite result correlated by job ID and source endpoint. Nonpersistent sessions, bounded time/output, read-only permissions and duplicate prevention are mandatory. Existing-session messages retain the mailbox/notification path.

## Native notifications

Named-target resolution runs in `scripts/resolve-target.mjs` with `desktop-open.mjs`. It can open an exact existing local desktop chat through the registered CLI in a host PTY, checking current non-archived metadata before launch and native identity afterward. One existing desktop session can alternatively relay native lookup/wake. A durable per-request attempt record prevents uncertain opens being repeated. The temporary CLI notification helper still only sends notifications; it does not expose desktop APIs. No replacement chat or permanent relay is created. See [native adapters](native-adapters.md#unloaded-claude-desktop-targets).

A harness may register one trusted notification template; discovered native IDs supply its targets. Legacy `runtime.notifications` entries remain available for explicitly configured endpoints. Each dispatch checks the current endpoint revision. An active runtime checks pending mail, reserves a durable notification and invokes the configured adapter. These checks do not call a model. The Claude notification adapter itself may use a bounded model worker; Codex uses its native queue directly. No central relay is required.

In stdio, `mail.send`, `mail.request` and `mail.reply` commit first, then await the configured bounded notification before returning (`timeout_ms` capped at 30000, with bounded shutdown). The response includes `native_notification` dispatch status, never proof of target receipt. A one-shot CLI therefore attempts its configured notification before closing. Mail stays durable if notification fails; retry only with the original idempotency key. The active-runtime timer remains for pending recovery. Notifications are required during normal harness setup; legacy per-endpoint entries still need explicit configuration.

- Codex queue acknowledgement establishes queuing only. Warnings and ambiguous output are uncertain.
- Claude Code `ListAgents`/`SendMessage` requires version-specific validation of the combined no-persist notification path and an unambiguous stable target. Its worker success does not prove target receipt.
- Copilot's documentation-based AHP notification adapter is experimental; installed-host access and behavior remain untested and may need changes.

Only the operator can configure harness discovery executables or notification templates. Discovered session metadata and profile data cannot authorize an executable. Refresh or relink changes the endpoint revision; the trusted notification binding must be reviewed and updated explicitly. An uncertain dispatch is inspected before administrator reset. Missing delivery leaves mail pending with a manual fallback; it never starts an implicit replacement session.

## Bounded workers

An explicit `worker.start` selects only a trusted `runtime.workers` entry whose `allow_endpoints` includes the caller. Native executables, models, cwd, permissions, persistence and limits are operator configuration, not prompt fields. Native worker sessions are separate from the requester and recipient.

SQLite owns job identity and bounded results; the launching runtime owns the child process. `worker.status` and `worker.wait` inspect the caller's job. `worker.ack` records that the result was received. The CLI `worker` helper keeps its connection open through bounded waits. Closing its stdio connection aborts its owned running jobs, whose outcomes may be uncertain. Durable records do not imply detached execution.

## Retention and shutdown

Maintenance runs while a runtime is active. When every runtime is closed, there is no notification delivery or timed cleanup; later runtime activity can resume eligible maintenance. No daemon or OS scheduler is installed implicitly.

Completed bodies are cleared immediately. Completed request/reply history and retry identities expire after 90 days; inactive, unreferenced sessions expire after 30 days. Capacity guards stop new work before storage exhaustion. Pending and uncertain work is retained. See [automatic retention](retention.md). Native history cleanup is separate: only configured persisted Codex workers support archive/delete in this version, after durable result acknowledgement and verified exit. Failed and uncertain jobs are not automatic cleanup candidates. Worker result records and backups have their own retention; native cleanup does not erase them.

No-persist, process exit, archive and delete are different outcomes. Immediate-child exit is not proof of descendant or remote-job exit. Neither logical deletion nor native cleanup promises zero residue or remote erasure.

## Optional HTTP and external knowledge

The [Docker/HTTP deployment](http-v04.md) retains the existing v0.4 capabilities with an exclusive database owner and explicit wake bridges. It does not gain stdio-only request/worker tools automatically. It is an alternative authority, never a parallel live copy of the same mail.

Shared skills, agent definitions and project memory remain in user-chosen files outside protocol state. Native adapters reference those sources. IHCP3K does not sync them, replicate sessions, schedule shared CPU/GPU resources or route ordinary prompts. See [onboarding](onboarding.md), [native adapters](native-adapters.md) and [protocol](protocol.md).
