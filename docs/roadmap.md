# Release scope

This page separates implemented features from future work. A **harness** is an app that runs an agent; an **adapter** connects that app's own commands to IHCP3K. See [terminology](terminology.md) for implementation terms.

## Version 1.1.1

The implementation was tested during the earlier development releases, including a bounded two-harness rehearsal; native setup and migration still require installed-version verification. See [validation](validation.md) for reported checks and remaining evidence gaps.

Version 1.1.1 provides local MCP stdio on an existing Node runtime, a shared SQLite schema, idempotent private installation, explicit correlated requests/replies, trusted native notifications and bounded worker jobs/results. It retains the directory and scoped credentials. The optional Docker/HTTP deployment remains v0.4 compatibility mode, without the new stdio request/worker APIs.

First installation asks where to save the files. The agent arranges the internal folders and records versions, model evidence, privileges, native bindings and retention. Native configuration is prepared for explicit setup. Offline backup restore to a new directory is distinct from live cutover and does not switch callers or unpause mail.

Ordinary prompts stay local. Codex notifications are deterministic; Claude notification workers require a validated no-persist messaging combination. Copilot workers are explicitly experimental; the documented existing-session AHP route is not yet a validated live integration. No automatic model routing or paid fallback is introduced.

Harness-wide registration and automatic session inventory are implemented for the installed Codex and Claude listing interfaces. Public commands no longer require registering each chat. Discovery does not imply that a native notification reached the target or that a dormant app can be awakened.

## Remaining gates

- Installed-version native behavior: idle/busy/unloaded targets, ambiguity, denials, reconnect, cancellation, acknowledgements and process ownership.
- Copilot adapter behavior and existing-host access; documented routes may need version-specific changes.
- Archive/delete visibility, ownership, worktree effects and actual retention, distinct from process exit and protocol results.
- Explicit single-authority migration/reconciliation and an authorized native configuration/cutover step.
- Wider clean-machine and concurrent-chat testing; app-closed delivery and OS-start recovery remain unverified.

## Later work

Automatic native model inventory, deterministic dispatch policy, service-backed resource scheduling, session/handover records, adapters for shared skills and memory, automated backup retention and stronger hostile-client isolation remain separate work. IHCP3K does not pool allowances, sync memory or transfer session ownership today.
