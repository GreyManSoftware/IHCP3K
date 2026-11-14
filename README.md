# Inter-Harness Communication Protocol 3000

**IHCP3K** is an experimental local coordination service for AI coding harnesses. The aim is to let assistants exchange durable work requests, coordinate resources and eventually hand work between harnesses without duplicating their knowledge or losing ownership of a task.

**Current release: synthetic prototype.** The tested MCP/SQLite core and a Claude-compatible waiter are included. It is not a production orchestrator, a live session importer, or an automatic model router. Public fixture credentials are for synthetic data only.

## Included today

- Standard MCP over Streamable HTTP, using the official MCP SDK.
- SQLite transactions for messages, duplicate protection, fenced claims and notification state.
- Explicit completion, immediate message-body cleanup and retained deduplication records.
- Pauses, bounded waiting, notification throttling and administrator reconciliation of uncertain work.
- An official-SDK waiter bundle that can run using an existing Node runtime without a host package install.
- Pinned Docker tooling and synthetic tests. No harness settings are changed by the test runner.

## Quick start

Requires Docker and an existing Node.js 24.15+ runtime. Dependency installation happens **inside Docker**, with dependencies and npm caches in named volumes. Only source and generated output are bind-mounted.

```sh
node scripts/dev.mjs test
```

This installs the locked dependencies into Docker volumes, runs the service tests, builds the waiter bundle and runs its tests sequentially. It uses at most two CPU cores per container and no GPU. Set `IHCP3K_TEST_LOCK` to an existing organisation-wide lock location if you coordinate test runs across projects; otherwise a repo-local lock is used. An occupied lock causes a clear refusal, not a parallel full-suite run.

To start the isolated synthetic demo after preparing dependencies:

```sh
node scripts/dev.mjs start
node scripts/dev.mjs status
node scripts/dev.mjs stop
```

The demo publishes only `127.0.0.1:43187`, runs non-root with a read-only root filesystem and keeps its database in the named `ihcp3k-demo-data` volume. Stopping removes the container but preserves named volumes. No automatic startup, live mailbox import, or real PA wake is configured. The portable start/stop wrapper is provided for evaluation; real harness connection and operational lifecycle validation remain future gates.

The synthetic sender, PA, waiter and administrator tokens are deliberately public in `service/fixture/config.json`. **Never use this fixture for real conversations or expose it to a network.** The runtime deliberately requires synthetic mode and test-prefixed recipients.

## Layout

| Path | Purpose |
| --- | --- |
| `service/` | MCP server, SQLite core, public fixture and tests |
| `adapters/claude-waiter/` | Official-SDK waiter source, lockfile and tests |
| `scripts/dev.mjs` | Portable Docker-only build/test/demo commands |
| `docs/architecture.md` | Boundaries, data lifecycle and planned coordination |
| `docs/protocol.md` | Implemented tool contract and failure semantics |
| `docs/roadmap.md` | Implemented versus proposed capabilities |
| `AGENTS.md` | Instructions for agents contributing to or consuming this repo |

## Validation and limits

The original isolated prototype passed 13 service tests, 16 waiter mock tests and eight independently run waiter/service integration checks. The public export's portable build/test results are recorded in `docs/validation.md`. Tests include abrupt process termination, duplicate sends, stale claims, pause precedence and body removal. An acknowledgement does not make an external deployment or other side effect exactly-once.

Real desktop MCP loading, credential isolation between sessions, app-closed wake behavior, safe live migration, backup/restore tooling and automatic delegation are **not yet validated or enabled**. MCP notifications alone do not start an idle model turn. Browser or desktop automation permissions remain those of the user and harness.

The repository contains no private chat history, live account configuration, session mappings, memories or imported Git history. See [security guidance](SECURITY.md) before experimenting beyond synthetic data.

License selection is pending. This independent project is not affiliated with or endorsed by OpenAI or Anthropic.
