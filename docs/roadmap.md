# Roadmap

## Implemented prototype

MCP/SQLite core, role-scoped synthetic identities, duplicate protection, claims, pauses, explicit reconciliation, deterministic maintenance and the official-SDK waiter. Tests cover the documented core behavior; real desktop integration remains separate.

## Next gates

1. Verify each supported harness can load the server and isolate PA credentials from send-only sessions.
2. Verify native idle/busy/restart behavior and visibly report unavailable wake paths.
3. Complete bounded dispatch recovery, operational status, backup/restore and migration tooling.
4. Rehearse a single-writer migration using synthetic snapshots, then explicitly authorized live data. Never dual-write file mail and SQLite.
5. Integrate canonical skills/memory references, verified session mirrors and checkpoint ownership transfer.
6. Add observed model catalogues, deterministic routing policy and coordinated CPU/GPU resource records.
7. Validate on clean installations before calling this a supported production release.

Publishing this experimental repository does not enable any of those capabilities or authorize changes to a user's live harness configuration.
