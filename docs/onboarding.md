# Register a harness and discover its sessions

Register each agent application once. Existing and future sessions appear through its native listing interface; they do not need individual tokens, grants or setup folders.

Follow [agent setup](../AGENT_SETUP.md) to choose the shared private runtime, prepare the harness's private configuration and native MCP entry. MCP (Model Context Protocol) is how the app calls IHCP3K tools.

## Register

```sh
node scripts/ihcp.mjs register /absolute/private/ihcp/runtime.json /absolute/private/harness-config.json /absolute/private/codex
node scripts/ihcp.mjs discover /absolute/private/codex
node scripts/ihcp.mjs refresh /absolute/private/codex
```

The first command requires the installation's operator credential and creates one harness credential. Discovery lists permitted harnesses and automatically creates stable addresses for their visible sessions. `refresh` forces a native rescan; ordinary discovery reuses a successful snapshot for up to 15 seconds. CLI paths are placeholders; the user chooses them.

Codex uses paginated, read-only `thread/list`. Claude uses `agents --json`. Only sessions exposed by the configured native account/host are visible. A fresh inventory connection's `notLoaded` status does not establish whether a desktop chat is active. Unknown harnesses need a discovery adapter before registration can claim this behavior.

## Send and receive

Put the exact source native ID and discovered destination address in a private `request.json`:

```json
{"session_id":"<source-native-id>","recipient":"<discovered-session-address>","body":"Review the supplied diff without editing files.","idempotency_key":"review-001"}
```

```sh
node scripts/ihcp.mjs remote_prompt /absolute/private/codex /absolute/private/request.json
```

The result contains a request ID. `prompt`, `chat` and `request` are compatibility aliases. Sending does not attach your conversation or files automatically; include authorized context or accessible file references.

The receiving session uses `check` with `{"session_id":"<its-native-id>"}`. To reply, provide that source ID plus the claimed message's `id`, `claim_token`, `generation`, reply `body` and a unique retry key as `idempotency_key`:

```sh
node scripts/ihcp.mjs check /absolute/private/claude /absolute/private/source-session.json
node scripts/ihcp.mjs reply /absolute/private/claude /absolute/private/reply.json
node scripts/ihcp.mjs status /absolute/private/codex /absolute/private/request-status.json
```

The status file contains `{"session_id":"<original-source-native-id>","id":"<request-id>"}`. Claim the reply and use `complete` with its claim fields, source ID and actual `outcome`. `in_reply_to` identifies the request answered. Do not assume any unrelated inbox message is the answer.

Every operation identifies its source session. Never select the latest chat or set a mutable current-session value on a shared MCP connection. Credentials authorize the harness; source IDs separate its conversations and are checked against native discovery. Clients sharing a harness credential share trust.

## Unregister

```sh
node scripts/ihcp.mjs unregister /absolute/private/codex
```

This revokes the harness and all its discovered session addresses. The skill also guides removal of that harness's recorded native MCP configuration. Other harnesses and shared messages remain. A retry of completed CLI unregister is harmless. A native app may still show cached tools until its supported configuration reload, but revoked calls fail.

A disconnected harness needs a deliberate new registration with fresh credentials; do not reuse an old credential or silently replay unresolved requests.

## Help and advanced operations

Every mode supports bare invocation or `--help`. Conversational examples and all modes are in [usage](usage.md). Source-session selection is assistance with routing, not another registration.

`enroll`, `register-session` and the older per-session `directory.*` workflow remain for legacy compatibility only. They are not part of a fresh harness install. The optional older HTTP deployment is documented separately in [the legacy guide](http-v04.md); it does not gain harness discovery merely by sharing a product version.
