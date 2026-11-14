# IHCP3K

**Inter-Harness Communication Protocol 3000** connects AI assistants running in different harnesses. It gives them durable messages and a way to notify each other, using MCP and a small Docker service with SQLite. Claude and Codex are the first tested clients.

**0.4 candidate:** registration, scoped discovery and the shared skill are implemented and tested in isolation. The real two-harness reinstall is still incomplete; see [validation](docs/validation.md).

## Why use it?

If you use more than one AI subscription, you may want to move work to the harness with allowance left, choose a different model for a particular job, or continue a project in another app. IHCP3K provides the messaging foundation. The broader workflows below are still being designed.

| Scenario | Available today | Planned |
|---|---|---|
| Spread work across subscriptions | Send an authorized request to a configured peer; choose the destination yourself. | Advisory usage snapshots are stored and discovered in 0.4; automatic work routing remains planned. |
| Use different models for different jobs | Exchange requests and results between configured Claude and Codex sessions. | 0.4 stores and discovers attributed model catalogues; automated native inventory and routing remain planned. |
| Hand over through your PAs | Send a handover request; the agents still verify the checkpoint, permissions and ownership themselves. | Integrated session and handover records. |
| Coordinate GPU and CPU work | Exchange resource requests and decisions; maintain the allocation ledger separately. | Service-backed capacity scheduling. |
| Let sessions talk directly | 0.4 enrols scoped receiving endpoints through a shared skill. A PA relay is optional. | Automatic native wake setup and request-specific reply correlation. |

**Allowances stay separate.** IHCP3K does not pool or transfer tokens, supply inference, or authorize paid overflow. Choosing a peer does not automatically dispatch work or change models.

## What works now

- Messages survive restarts, with duplicate protection, fenced claims and explicit completion.
- Scoped credentials restrict which inboxes a client can send to or read.
- A Codex queue bridge and a Claude background waiter provide native notifications.
- Bounded active reply waits suppress new doorbells. Already queued notifications cannot be recalled.
- Completed message bodies are cleared while duplicate identities remain. Backup, restore and legacy import tools are included.

**Experimental.** Native CLI connections are tested. Desktop wake depends on the harness and version; closed-app wake and automatic startup remain unverified. Further notification reductions and automatic routing remain design-stage features. Registration and advisory discovery are in the 0.4 candidate.

## Set it up

For installation, give your assistant [AGENT_SETUP.md](AGENT_SETUP.md) and the [shared skill](skills/harness-interop/SKILL.md). The [onboarding guide](docs/onboarding.md) covers install, register, discover and unlink. It covers setup, daily use, recovery, shared skills and memory, and adapting an unfamiliar harness. You choose the receiving threads; installation does not create or elect management chats. Private mail, credentials and session mappings stay outside the repository.

To try the synthetic demo, use an existing Node.js 24.15+ installation and Docker:

```sh
node scripts/dev.mjs test
node scripts/dev.mjs start
```

It runs on `127.0.0.1:43187` with public test credentials, unsuitable for real conversations. Stop it with `node scripts/dev.mjs stop`. Dependencies and build tools stay in Docker volumes.

[Architecture](docs/architecture.md) · [Protocol](docs/protocol.md) · [Setup and session roles](docs/first-run-review.md) · [Validation](docs/validation.md) · [Security](SECURITY.md)

License selection is pending. This independent project is not affiliated with OpenAI or Anthropic.
