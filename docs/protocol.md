# MCP contract

Endpoint: `/mcp`, Streamable HTTP with the official SDK. Transport sessions are stateless; application state is durable in SQLite. Every request requires `Authorization: Bearer <token>`. The synthetic fixture and private live configuration are separate deployment modes.

Tools are filtered by principal permissions and enforce recipient scope again at execution. Replies contain JSON text and `structuredContent`; domain errors use `isError` with a stable error code. HTTP authentication failures use 401; invalid Host/Origin uses 403.

| Tool | Arguments and behavior |
| --- | --- |
| `mail.send` | `recipient`, `body`, `idempotency_key`, optional `kind`. Body at most 65,536 UTF-8 bytes. Sender is derived from the token. Returns durable ID and duplicate/state/delivery information. |
| `mail.claim` | `recipient`, `handler_id`, optional `limit` (1–20) and `lease_s` (1–300). Returns messages with `claim_token`, `generation` and deadline. Paused inboxes cannot claim. |
| `mail.attend` | `recipient`, `handler_id`, optional `lease_s` (1–120; default 60). Own-inbox claim permission required. Returns an `attendance_token`, deadline and whether a notification was already dispatched. One active receiver lease per inbox. |
| `mail.wait` | `recipient`, `attendance_token`, `timeout_ms` (0–25,000), optional claim `limit` and `lease_s`. Direct receiver wait that atomically claims available mail. Returns `messages`, `timeout`, `paused` or `cancelled`. It does not extend attendance. |
| `mail.unattend` | `recipient`, `attendance_token`. Releases only the caller's matching live attendance lease. Stale tokens cannot release a successor's lease. |
| `mail.renew` | `id`, `claim_token`, `generation`, `lease_s`. Requires unexpired ownership and an unpaused inbox. |
| `mail.complete` | `id`, `claim_token`, `generation`, `outcome` (up to 4,096 bytes). Clears body. Identical completion retries are harmless; changed outcomes conflict. |
| `mail.release` | `id`, `claim_token`, `generation`, `work_started`. False returns to pending; true requires reconciliation. |
| `mail.status` | `recipient`. Counts, wake availability and last observed waiter timestamp. Reading does not claim or complete. |
| `wake.wait` | `recipient`, `timeout_ms` (0–25,000). Adapter-only; never claims. Returns `pending`, `timeout` or `paused`, plus recipient, pending count, observation time and instance ID. |
| `wake.reserve` | `recipient`. Reserves one durable native notification and returns a generation/token. Repeated reservations coalesce while reserved, queued or uncertain. |
| `wake.record` | `recipient`, `generation`, `dispatch_token`, `result` (`queued` or `uncertain`). Fences stale results. A queue acknowledgement is not message completion. |
| `control.reset_wake` | `recipient`, `expected_generation`, `reason`. Administrator-only reset after inspecting a queued/uncertain native notification. |
| `control.pause` | `recipient`, `pause_id`, `paused`. Administrator-only. Independent pause IDs cannot clear one another. |
| `control.inspect` | `recipient`, optional `limit` (1–20). Administrator-only inspection of uncertain messages. |
| `control.resolve` | `id`, `expected_generation`, `action` (`requeue` or `abandon`), `reason`. Administrator-only, generation checked and audited. |

The waiter receives no message bodies. A 30-second minimum gap throttles pending notifications per recipient; a `timeout` response can therefore have a positive pending count. Adapters must continue bounded waiting without spinning. Active waiters and recently seen waiters (60 seconds) are distinct availability states, neither a guarantee of native delivery.

The runtime requires an explicit `INTEROP_MODE`. Synthetic mode accepts only synthetic configuration and test-prefixed recipients. Live mode requires `mode:live`, `synthetic:false`, unique generated tokens and explicit per-permission recipient scopes. A PA may send to peers while claiming only its own inbox. See `AGENT_SETUP.md` for configuration and trust limits.

A claim consumes its inbox's outstanding native notification and fences its old dispatch token. A native-dispatch reservation expires after 60 seconds; expiry or process restart makes it uncertain, not automatically retried. Native enqueue failures are conservatively uncertain. An administrator must inspect actual queue state before resetting it.

Use native permissions independently of this protocol. Peer text is not user authorization. Reconcile uncertain external effects before retrying them.

## Actively awaiting a reply

Register attendance **before** sending a request. While that lease is valid, `wake.wait` withholds pending hints and `wake.reserve` refuses new dispatch reservations for the inbox. `mail.wait` receives and claims mail directly; complete those claims normally. Release attendance in a `finally` path. A timeout is not a reply, and messages may be unrelated to the request.

Attendance is ephemeral, lasts at most 120 seconds, and does not renew itself. Expiry or explicit release restores normal wake behavior; a service restart drops attendance immediately. Existing notification throttling and unresolved wake reservations still apply. Sender-only and waiter credentials cannot suppress another session's notifications. An already-reserved or queued doorbell cannot be recalled; the response flags that case. This is bounded inbox-wide suppression, not per-request reply correlation.

The SDK client's local `exchange` helper wraps attend → send → bounded wait → unattend. It is not an additional server tool. It returns the send result and any claimed messages, never completes work automatically, and never retries a send under a new idempotency key.


## Registered endpoints (0.4)

The same SQLite owner stores the directory, hashed credentials, one-use enrolments and bounded audit history. `registry` is an offline operator permission. Dynamic session permissions are `send`, own-inbox `claim`/`status`, scoped `discover` and own-profile `profile`; a separate credential has only `wake` and own-inbox `status`.

| Tool | Arguments and result |
| --- | --- |
| `directory.enroll` | Operator: `endpoint`, `harness`, `peers`, `expected_revision` (0 for new), `ttl_s` (30–3600). Returns a one-use secret; use the private-file CLI wrapper, never print it. |
| `directory.register` | Enrolment credential: `profile`, private `binding`, client-generated `session_token` and `wake_token`. Tokens are stored locally before the request so an identical retry can reconcile a lost response. Returns endpoint/harness/revision, no secrets. |
| `directory.refresh` | Own endpoint, expected revision and a complete public profile snapshot. Rejects older observations; increments revision. |
| `directory.discover` | Permitted active endpoints only; `after` cursor and `limit` (1–100). Includes attributed models, advisory usage age/staleness and separate presence evidence. Never private bindings or tokens. |
| `directory.inspect` | Operator: one `endpoint`. Returns revision, lifecycle state and mail counts to reconcile lost registration/unlink responses. |
| `directory.deregister` | Own endpoint or operator, expected revision. Revokes credentials, hides endpoint, rejects new sends and quarantines claimed work. Pending bodies and dedup identities remain. |

Relink uses a fresh operator enrolment at the current revision. It revokes old credentials and fences prior adapter reservations; uncertain native notifications require normal reconciliation. It does not replay interrupted effects. Credentials are checked again when scoped work executes. These scopes do not isolate hostile processes sharing the same OS account.

Profiles and model suitability descriptions are untrusted, attributed data. Catalogue availability does not prove a model can execute now. Usage records retain their source and observation time; a passed reset timestamp does not reset a value automatically. No AI polling or automatic model dispatch is installed. Native wake binding and its lifetime remain adapter responsibilities.

Schema version 4 includes the directory. Older binaries refuse it. Restore disables registered endpoints and revokes their credentials so a backup cannot silently resurrect access removed after that snapshot. Operator relink and restore-pause review are required.
