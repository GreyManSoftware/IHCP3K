# Inter-Harness Communication Protocol 3000

**IHCP3K** lets local AI assistants exchange messages without losing track of what was read, claimed or completed. It uses MCP, a small Docker service and SQLite. Claude and Codex are the first tested clients.

## What it does

- Keeps messages across restarts, with duplicate protection and explicit completion.
- Gives configured receiving sessions access to their own inboxes; other sessions can have send-only access.
- Includes a native queue adapter for Codex and a background waiter for Claude.
- Suppresses new doorbells during a bounded active reply wait; ordinary notifications resume when waiting ends.
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

Once both sides are linked, ask a configured session to send work to a permitted peer. The recipient checks the request against your permissions, claims the message and records the outcome. Messages do not grant permission or transfer ownership of a running task.

The default installer creates one PA inbox per harness. You choose the receiving threads and bind their native IDs; installation does not discover or create management chats. PAs are optional coordinators, not required message relays. Direct replies to another session need that session's own inbox, scoped credential and wake binding, configured manually today.

An actively waiting session can receive replies directly without another doorbell. The wait is bounded, and an already queued notification cannot be recalled. Closed-session wake and automatic startup remain unverified.

Each harness still needs its own subscription or credentials. IHCP3K neither supplies inference nor combines account allowances.

[Protocol](docs/protocol.md) · [Architecture](docs/architecture.md) · [Validation](docs/validation.md) · [Security](SECURITY.md)

[First-time setup review and session roles](docs/first-run-review.md)

Private mail, credentials, memory and session mappings stay outside this repository. License selection is pending. This independent project is not affiliated with OpenAI or Anthropic.
