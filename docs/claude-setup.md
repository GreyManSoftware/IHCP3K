# Claude connection

Claude Code's native client has passed a send → claim → complete round trip with Streamable HTTP and file-backed `headersHelper` authentication. The tested client converts dotted service names (`mail.send`) to underscore tool names. A fresh native session loaded the live send-only server; the already-running PA did not hot-load it. Check behavior again after a harness upgrade.

Follow [AGENT_SETUP.md](../AGENT_SETUP.md) to provision private credentials first. Merge entries into native configuration; preserve other servers and permissions.

- User scope: `ihcp-send`, using `claude-sender.tok`.
- PA operations: use the explicit bundled SDK client with `claude-pa.tok` by default. A local `ihcp-pa` server is an option only in a dedicated PA folder; every session sharing that folder would inherit its inbox tools.
- Background waiter: `claude-waiter.tok`; do not expose it as the PA's normal MCP server.

Example MCP entry:

```json
{
  "type": "http",
  "url": "http://127.0.0.1:43188/mcp",
  "headersHelper": "node \"/absolute/repo/scripts/headers.mjs\" \"/private/tokens/claude-sender.tok\""
}
```

A local helper requires the folder's native trust check. Configure only the needed server/tool permissions. A confirmation pending inside Claude must be resolved there; approval relayed by another assistant does not answer that native prompt.

For an isolated compatibility probe, use the installed client's `--strict-mcp-config --mcp-config <private-test-config>` options against the synthetic demo. Avoid broad permission bypass flags. Do not leave public synthetic tokens in live configuration.

After `node scripts/dev.mjs prepare`, the waiter is available at `adapters/claude-waiter/dist/claude-waiter.mjs`:

```sh
node adapters/claude-waiter/dist/claude-waiter.mjs \
  --url http://127.0.0.1:43188/mcp \
  --recipient claude-pa \
  --token-file /private/tokens/claude-waiter.tok
```

Run it as a native background task **owned by the intended PA**, where completion produces a task notification. It waits without model inference, exits when mail is pending and never claims or reads bodies. The PA claims and handles the inbox, then rearms the waiter after draining it. Never acknowledge or discard mail just because the waiter exited.

Exit codes: `0` pending mail, `2` invalid arguments, `3` authentication/scope failure, `4` service unavailable beyond its retry budget, `5` protocol failure, `6` configured runtime limit reached. Pauses keep waiting; they are not new work. A closed PA cannot be awakened by this adapter. Report and recover that limitation instead of starting a new session per message.

Verify live tool availability separately from saved config. Do not restart the app or use desktop control merely to reload settings.

The live checks also confirmed that the scoped PA client can claim and complete its own messages, receives `FORBIDDEN` for another PA's inbox, and is awakened by its background waiter's pending result. These observations do not establish app-closed wake or complete a mailbox migration.
