# Validation

This public export has a fresh Git history and an explicit source allowlist. Runtime mail, account configuration, chat IDs, personal memory and private repository history are excluded.

The portable Docker runner was used on the exported tree; all 29 tests passed:

- Service: 13 behavior tests, including actual child-process termination, SQLite recovery/integrity, concurrent duplicate sends, claims, pause handling and cleanup.
- Waiter: 16 mock tests against the built official-SDK bundle, including scoped authentication, bounded polling, pause handling and recovery.

Before export, an independent adapter implementation also passed eight integration scenarios against the synthetic service, including the deliberate 30-second notification gap. Those were prototype integration results, not a fresh public-demo launch test.

The portable start/stop wrapper and real desktop MCP configuration are not validated by the test command. Closed Claude-session wake is unsupported by the current adapter; closed/restarted Codex behavior remains untested. No live harness settings or mailboxes were migrated to publish this repository.
