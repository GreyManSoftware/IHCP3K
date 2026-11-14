# Security and deployment status

IHCP3K currently supports synthetic evaluation only. Its checked-in bearer strings are public test fixtures, not deployable credentials. Do not send private work through the demo or publish its port on a non-loopback interface.

The service authenticates requests, restricts tools by principal, validates inbox scope and checks Host/Origin. This does not establish isolation between full-access processes running as the same OS user. Folder-scoped configuration alone does not isolate sessions sharing that folder.

Completion removes the logical message body. It does not guarantee forensic erasure from SQLite pages, WAL files, backups or storage hardware. Compact dedup records persist so old resends cannot silently become new work. Uncertain actions require reconciliation.

Never place real credentials, conversation history or live mappings in this repository. Before publication, scan staged files and Git history. For a security report, use GitHub private vulnerability reporting if available; do not post secrets or private payloads in a public issue. If that facility is unavailable, open only a non-sensitive request for a private reporting channel.

Production release gates include credential provisioning/rotation, bounded operational recovery, backup and quarantined restore, crash-safe native wake accounting, storage limits, upgrade/rollback procedures and live harness compatibility testing.
