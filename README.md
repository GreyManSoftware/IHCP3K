# Inter-Harness Communication Protocol 3000

**IHCP3K** lets local AI assistants exchange messages without losing track of what was read, claimed or completed. It uses MCP, a small Docker service and SQLite. Claude and Codex are the first tested clients.

## What it does

- Keeps messages across restarts, with duplicate protection and explicit completion.
- Gives each PA access to its own inbox; ordinary sessions can have send-only access.
- Includes a native queue adapter for Codex and a background waiter for Claude.
- Cleans up completed message bodies without forgetting their duplicate identities.
- Provides backups, cautious restores and an importer for the earlier file mailbox.

**Experimental release.** Native CLI connections are tested. Desktop reload and wake behavior depend on the harness and version. Automatic model selection, resource scheduling and session handover are not implemented by the service yet.

## Try it

You need an existing Node.js 24.15+ installation and Docker. Dependencies and build tools stay in Docker volumes.

```sh
node scripts/dev.mjs test
node scripts/dev.mjs start
```

This starts a synthetic demo on `127.0.0.1:43187`. Its public test credentials are unsuitable for real conversations. Stop it with `node scripts/dev.mjs stop`.

For a real setup, give your assistant [AGENT_SETUP.md](AGENT_SETUP.md). It covers installation, daily use, recovery, shared knowledge and adding an unfamiliar harness. Nothing installs itself or changes your harness settings just by cloning this repo.

## Using it

Once both sides are linked, ask your PA to send work to the other harness. The recipient checks the request against your permissions, claims the message and records the outcome. Messages do not grant permission or transfer ownership of a running task.

Each harness still needs its own subscription or credentials. IHCP3K neither supplies inference nor combines account allowances.

[Protocol](docs/protocol.md) · [Architecture](docs/architecture.md) · [Validation](docs/validation.md) · [Security](SECURITY.md)

Private mail, credentials, memory and session mappings stay outside this repository. License selection is pending. This independent project is not affiliated with OpenAI or Anthropic.
