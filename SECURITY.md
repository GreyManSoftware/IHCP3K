# Security

IHCP3K is designed for trusted agent applications on one computer. Remote multi-user hosting is outside the supported scope. The default MCP (Model Context Protocol) connection runs through a local process; the optional HTTP server must stay on loopback (`127.0.0.1`).

## Credentials and permissions

Each registered harness receives a credential restricted to its permitted peer harnesses. Each mail operation identifies its source session, which must exist in the owning harness's native inventory. Claims and replies are scoped to that source's inbox. Reciprocal peer permission is required. Administrator credentials stay out of ordinary MCP entries.

A harness-wide MCP entry intentionally shares the harness credential across its sessions. This prevents accidental inbox mixing through explicit source IDs; it does not isolate malicious clients holding that credential. Such clients can act as other sessions in the same harness. Processes with full access under the same OS account can also read one another's files. Legacy per-session tokens must not be substituted for the harness token in a global entry.

Discovery uses fixed read-only native interfaces, with deadlines, output/page limits and exact IDs. It omits conversation previews and never reads transcript bodies or starts/resumes a thread. Failed or incomplete discovery does not erase the last inventory or authorize new sending. Native executables and notification templates are operator configuration, not data supplied by peers.

A message from another agent is data, not user permission. Native app permissions still apply. If a request may already have changed an external system, inspect what happened before retrying it.

## Stored data

Completing a message clears its logical content. Small records remain to recognise duplicate requests. This is not secure erasure: database pages, SQLite's write-ahead log, backups and storage devices may retain old content. Backups require a separate retention decision. Pending-message limits are not a disk quota.

Keep credentials, private history, session mappings and project memory outside public source. Never print authentication-helper output into logs or chats. Back up configuration before changing it, and coordinate credential rotation with affected clients.

The service checks credentials, recipient permissions, HTTP Host/Origin headers, message sizes and handler ownership. These checks reduce accidental exposure and duplicate processing; they do not isolate a malicious process with access to the same files. See [terminology](docs/terminology.md) and [the protocol](docs/protocol.md) for implementation details.

## Reporting a problem

Use GitHub private vulnerability reporting if available. Otherwise open a non-sensitive request for a private contact channel. Never include credentials or private message contents in a public issue.
