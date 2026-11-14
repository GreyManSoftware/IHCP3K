# Security

The synthetic demo's credentials are public test strings. Live mode rejects that configuration. Keep the service on loopback; remote multi-user deployment is outside this release's supported scope.

Live credentials are generated separately for senders, PAs, waiters and administrators. Tools are filtered by role and recipient scope is checked again during execution. Keep PA credentials local to the intended PA project and admin credentials out of model-facing MCP configuration. Same-user, full-access processes can still read each other's files; project scope is not a hostile-process sandbox.

Request authentication, Host/Origin checks, bounded request sizes, pending limits and claim fencing reduce accidental exposure and replay. A peer message is data, not permission. An uncertain external effect must be reconciled before retrying it.

Completion clears the logical body; it does not securely erase SQLite pages, WAL files, backups or storage hardware. Dedup identities persist. Backups have manual retention. The pending-message limit is not a disk quota; monitor named-volume space.

Private credentials, history, session mappings and memory belong outside this repository. Do not log header-helper stdout. Back up configuration before changing it. Rotation requires coordinating token files, server config and a controlled service restart; never silently invalidate another running client.

For security reports, use GitHub private vulnerability reporting if available. Otherwise open only a non-sensitive request for a private channel; never put credentials or private payloads in a public issue.
