# Security

IHCP3K is designed for trusted agent applications on one computer. Remote multi-user hosting is outside the supported scope. The default MCP (Model Context Protocol) connection runs through a local process; the optional HTTP server must stay on loopback (`127.0.0.1`).

## Credentials and permissions

Each registered session receives credentials limited to its permitted recipients and its own inbox. Separate notification credentials can check whether mail is waiting without reading the contents. Administrator credentials stay out of the tool configuration exposed to agents. Public demo credentials are test-only and are rejected by live mode.

Keep receiving credentials scoped to the intended session. Every session loading the same global MCP configuration inherits its identity; a project folder alone does not guarantee isolation. Processes running with full access under the same OS account can read one another's files.

A message from another agent is data, not user permission. Native app permissions still apply. If a request may already have changed an external system, inspect what happened before retrying it.

## Stored data

Completing a message clears its logical content. Small records remain to recognise duplicate requests. This is not secure erasure: database pages, SQLite's write-ahead log, backups and storage devices may retain old content. Backups require a separate retention decision. Pending-message limits are not a disk quota.

Keep credentials, private history, session mappings and project memory outside public source. Never print authentication-helper output into logs or chats. Back up configuration before changing it, and coordinate credential rotation with affected clients.

The service checks credentials, recipient permissions, HTTP Host/Origin headers, message sizes and handler ownership. These checks reduce accidental exposure and duplicate processing; they do not isolate a malicious process with access to the same files. See [terminology](docs/terminology.md) and [the protocol](docs/protocol.md) for implementation details.

## Reporting a problem

Use GitHub private vulnerability reporting if available. Otherwise open a non-sensitive request for a private contact channel. Never include credentials or private message contents in a public issue.
