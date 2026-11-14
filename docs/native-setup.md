# Connect a native harness

Install and register an endpoint using [onboarding](onboarding.md) first. Keep its receiving credential scoped to the intended session. A global MCP entry with a fixed token gives every session that loads it the same identity; passing that token as an argument or environment variable does not create session isolation.

Use a per-invocation configuration for a bounded CLI test. For a persistent desktop connection, verify the app's actual configuration scope and reload behavior before installing it. If it cannot isolate receiving identities, do not advertise a global connection as per-session registration. Explicit scoped SDK access is a separate supported client, not evidence that native MCP tools work.

## Claude Code

Write a private MCP JSON file containing the scoped launch contract from [agent setup](../AGENT_SETUP.md). For a disposable native load test, use the installed CLI's `--mcp-config <file> --strict-mcp-config` options, an explicitly selected available model, `--no-session-persistence`, and a narrowly selected `--allowedTools` list. Ask it to discover the directory and inspect its own mailbox, then finish.

The observed CLI also supports `claude mcp add -s local <name> -- <command> <args...>` for project-local setup and `-s user` for user-wide setup. Those are persistent changes and require an explicit scope decision. A project scope can still contain multiple sessions. Do not assume an existing desktop chat hot-loads a newly added server.

The v0.5 rehearsal passed native directory discovery and mailbox inspection through an invocation-scoped stdio configuration. It does not prove the separate notification adapter's restricted messaging flags or desktop reload behavior.

## Codex

The installed CLI accepts invocation-only `-c` overrides for the stdio command, arguments and tool allow list. Keep the existing native policy and use a read-only filesystem sandbox for inspection. Do not use sandbox-bypass flags as an installation requirement.

Use an **interactive** first-use check when tools require approval. `codex exec` cannot present the same interactive approval flow: in the observed v0.5 rehearsal, tools loaded but both calls failed with `MCP tool call requires approval, but approval policy is never`.

Current [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) describes `enabled_tools` and per-tool `approval_mode`. A separately approved headless retry using the two raw dotted tool names still failed on the tested build. The cause is unresolved; do not label these settings as a verified unattended recipe, silently broaden the grant, or substitute SDK results for a native pass.

For an interactive inspection, expose only `directory.discover` and `mail.status`, ask for those two calls, and let the user approve them in the native client. This passed on CLI `0.167.0-alpha.4.1`: both tools returned actual results after the user selected **Always allow** separately for each. The native client may persist that choice; record its scope as part of setup and cleanup. The launch itself used invocation-only MCP configuration.

Stop after the results. A server appearing in `/mcp` alone is insufficient. Record the CLI version, exact effective configuration, tool results and any error before proceeding to message-writing permissions. Approval of inspection tools does not approve every mail or worker operation.

## Other harnesses

Start with their documented MCP stdio configuration and permission flow. Test one isolated endpoint, then reciprocal discovery, correlated requests/replies, reconnect and unlink. Verify native notification separately. Record unsupported operations explicitly. Copilot remains experimental and untested against an installed host; an unknown harness is not supported merely because it claims MCP compatibility.

Do not remove the current installation until the replacement's required paths have passed and one authority has been selected. See [cutover](cutover.md).
