# Connect a native harness

“Native” here means the agent app's own tools, settings and permission prompts. **MCP (Model Context Protocol)** supplies the IHCP3K tools; **stdio** is the local process connection. An **endpoint** is the session's registered messaging identity. “Scope” describes which sessions inherit a configuration or credential. See [terminology](terminology.md) for supporting terms.

Register the harness once using [agent setup](../AGENT_SETUP.md). Install the returned MCP entry in the selected harness-wide scope using `harness.tok`. Its tools accept an exact source `session_id` on each mail operation, so a shared MCP process does not mix conversations. All sessions of that harness share the credential's trust boundary; they are not isolated from malicious clients in the same harness.

Use the native app's reliable session metadata to choose the source ID from automatic discovery. Do not infer it from a title, latest activity or process-wide mutable setting. A harness configuration reload may be needed for existing chats; that is not another registration.

The default launch is `<node> <runtime>/bundles/stdio.mjs <runtime>/runtime.json <harness>/harness.tok`. For a bounded test use invocation-only configuration; for the user-approved installation use the app's supported harness-wide configuration. Never expose the installation administrator token in this entry.

Current harness tools are `harness.discover`, `session.status` and the other `session.*` operations. The version-specific observations below used the older per-session tools; they are historical evidence, not a test of the new registration contract.

## Claude Code

Write a private MCP JSON file containing the scoped launch contract from [agent setup](../AGENT_SETUP.md). For a disposable native load test, use the installed CLI's `--mcp-config <file> --strict-mcp-config` options, an explicitly selected available model, `--no-session-persistence`, and a narrowly selected `--allowedTools` list. Ask it to discover the directory and inspect its own mailbox, then finish.

The observed CLI also supports `claude mcp add -s local <name> -- <command> <args...>` for project-local setup and `-s user` for user-wide setup. Those are persistent changes and require an explicit scope decision. A project scope can still contain multiple sessions. Do not assume an existing desktop chat load without restartings a newly added server.

The v0.5 rehearsal passed native directory discovery and mailbox inspection through an invocation-scoped stdio configuration. It does not prove the separate notification adapter's restricted messaging flags or desktop reload behavior.

## Codex

The installed CLI accepts invocation-only `-c` overrides for the stdio command, arguments and tool allow list. Keep the existing native policy and use a read-only filesystem sandbox for inspection. Do not use sandbox-bypass flags as an installation requirement.

Use an **interactive** first-use check when tools require approval. `codex exec` cannot present the same interactive approval flow: in the observed v0.5 rehearsal, tools loaded but both calls failed with `MCP tool call requires approval, but approval policy is never`.

Current [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) describes `enabled_tools` and per-tool `approval_mode`. A separately approved headless retry using the two raw dotted tool names still failed on the tested build. The cause is unresolved; do not label these settings as a verified unattended recipe, silently broaden the grant, or substitute SDK results for a native pass.

For an interactive inspection with the historical per-session client, expose only `directory.discover` and `mail.status`, ask for those two calls, and let the user approve them in the native client. This passed on CLI `0.167.0-alpha.4.1`: both tools returned actual results after the user selected **Always allow** separately for each. The native client may persist that choice; record its scope as part of setup and cleanup. The launch itself used invocation-only MCP configuration.

Stop after the results. A server appearing in `/mcp` alone is insufficient. Record the CLI version, exact effective configuration, tool results and any error before proceeding to message-writing permissions. Approval of inspection tools does not approve every mail or worker operation.

## Other harnesses

Start with their documented MCP stdio configuration and permission flow. First implement and verify native session listing, then test one harness registration, discovery of several sessions, correlated replies and whole-harness unregister. Verify native notification separately. Record unsupported operations explicitly. Copilot remains experimental and untested against an installed host; an unknown harness is not supported merely because it claims MCP compatibility.

Do not remove the current installation until the replacement's required paths have passed and one authority has been selected. See [cutover](cutover.md).
