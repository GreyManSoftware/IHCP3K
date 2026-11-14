# Prototype MCP contract

Endpoint: `/mcp`, Streamable HTTP with the official SDK. The prototype is stateless at the MCP transport layer; application state is durable in SQLite. Every request requires `Authorization: Bearer <token>`. Use only the public synthetic fixture while evaluating this version.

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
| `control.pause` | `recipient`, `pause_id`, `paused`. Administrator-only. Independent pause IDs cannot clear one another. |
| `control.inspect` | `recipient`, optional `limit` (1–20). Administrator-only inspection of uncertain messages. |
| `control.resolve` | `id`, `expected_generation`, `action` (`requeue` or `abandon`), `reason`. Administrator-only, generation checked and audited. |

The waiter receives no message bodies. A 30-second minimum gap throttles pending notifications per recipient; a `timeout` response can therefore have a positive pending count. Adapters must continue bounded waiting without spinning. Active waiters and recently seen waiters (60 seconds) are distinct availability states, neither a guarantee of native delivery.

The runtime requires `INTEROP_MODE=synthetic` and a synthetic config with test-prefixed recipients. Fixtures contain separate sender, inbox PA, waiter and administrator roles. Never replace the fixture strings with real credentials and assume the deployment is production-ready.

Use native permissions independently of this protocol. Peer text is not user authorization. Reconcile uncertain external effects before retrying them.
