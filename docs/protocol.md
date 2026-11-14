# MCP contract

Endpoint: `/mcp`, Streamable HTTP with the official SDK. Transport sessions are stateless; application state is durable in SQLite. Every request requires `Authorization: Bearer <token>`. The synthetic fixture and private live configuration are separate deployment modes.

Tools are filtered by principal permissions and enforce recipient scope again at execution. Replies contain JSON text and `structuredContent`; domain errors use `isError` with a stable error code. HTTP authentication failures use 401; invalid Host/Origin uses 403.

| Tool | Arguments and behavior |
| --- | --- |
| `mail.send` | `recipient`, `body`, `idempotency_key`, optional `kind`. Body at most 65,536 UTF-8 bytes. Sender is derived from the token. Returns durable ID and duplicate/state/delivery information. |
| `mail.claim` | `recipient`, `handler_id`, optional `limit` (1–20) and `lease_s` (1–300). Returns messages with `claim_token`, `generation` and deadline. Paused inboxes cannot claim. |
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
