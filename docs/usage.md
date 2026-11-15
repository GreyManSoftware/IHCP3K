# Using IHCP3K

A harness is the app running your assistant. Install the [harness-interop skill](../skills/harness-interop/SKILL.md) and register your harnesses once using [agent setup](../AGENT_SETUP.md) first.

## Which route to use

- Codex to another local Codex chat: use Codex's native messaging.
- Codex to Claude, or Claude to Codex: use IHCP3K.
- An explicit IHCP3K command or protocol test: use IHCP3K, even within one harness.

For example, "Ask the backend chat about the API" stays within your current harness when that chat is local. "Ask Claude's backend chat about the API" from Codex uses IHCP3K. Installing the skill does not redirect every chat message through it.

## In a conversation

Tell the assistant to use the skill, then give it a mode and the information it needs:

```text
Use harness-interop: /register Codex
Use harness-interop: /discover sessions
Use harness-interop: /discover models
Use harness-interop: /remote_prompt Claude Ask the review agent to do ABC
Use harness-interop: /status <request-id>
Use harness-interop: /unregister Codex
```

`Claude` names the target harness, not an internal session address. The skill discovers that harness and resolves a suitable session from project context or an explicit role in the request. Each harness registers once and its sessions are discovered automatically. A session can ask another session directly; no special management chat is needed. Model listings include their source and age, and do not prove that the model or allowance is still available.

These are instructions interpreted by the skill. They do not install native slash commands or autocomplete. Where the app treats a leading `/` specially, use the full `Use harness-interop: ...` form. Plain-language requests work too.

## Help before action

Every mode supports a bare invocation, `--help`, `-h` or `?`. The assistant must explain purpose, arguments and an example before taking action. Missing required details also trigger assistance. Help does not send mail, register or disconnect anything, claim messages, edit configuration, acknowledge results or start work.

```text
Use harness-interop: /remote_prompt
Use harness-interop: /remote_prompt --help
Use harness-interop: /unregister --help
```

For `/remote_prompt`, help can show the actual permitted destinations from your configured connection. If no connection exists, it explains registration instead. If several harness instances or sessions remain equally suitable, clarify the destination rather than sending to an arbitrary chat. This is task routing, not an installation step. The syntax is:

```text
/remote_prompt <harness> <request>
```

`/prompt`, `/chat` and `/request` remain aliases. `/unlink` is a compatibility alias for unregister; with a harness folder it disconnects the whole harness.

## Disconnect a harness

`/unregister Codex` revokes the chosen harness's credential and all its automatically discovered session addresses. The skill then removes only that harness's recorded IHCP3K MCP configuration. Other harnesses, unrelated settings, source files and shared messages remain.

A bare `/unregister` displays help. Before disconnecting, the agent resolves active work and identifies the exact harness instance. It reports partial native-settings removal honestly. An intentional later registration rotates the revoked credential; old clients do not regain access.

## All modes

The skill also supports the lower-level modes below. Each must offer usage assistance. JSON inputs are private files used by the command-line interface, not text you need to construct for ordinary conversational use.

| Mode | Purpose / required information |
| --- | --- |
| `register` | Register one harness, with its native discovery adapter, profile and permitted peer harnesses. No individual chat enrolment. |
| `discover` | List permitted sessions or their advertised models. |
| `resolve` | Resolve a named target or request a Claude Desktop wake through one existing desktop session. |
| `remote_prompt` | Send a request to a named harness; the skill resolves the destination session. |
| `status` | Inspect a request ID, or inbox counts with `status inbox` (the skill supplies the current source ID). |
| `unregister` | Disconnect an explicitly named harness and all its session addresses. |
| `refresh` | Force native session discovery again. |
| `check` | Claim waiting messages for handling; this is not a read-only status check. |
| `reply` | Reply using a request's current claim credentials. |
| `send` | Send a message without automatic request/reply tracking. |
| `complete` | Mark a claimed message handled, with its actual outcome. |
| `renew` | Extend an active claim's time limit. |
| `release` | Release a claim and say whether work started. |
| `worker` | Run an explicitly configured task in a separate session. |
| `worker-status` | Inspect a worker's recorded status/result. |
| `worker-ack` | Acknowledge a result after checking it. |
| `enroll` | Legacy administrator: issue a per-session grant; not used for harness registration. |
| `inspect` | Legacy administrator: inspect an individually enrolled endpoint. |
| `register-session` | Legacy per-session enrolment only; not part of a fresh install. |
| `exchange` | Legacy send-and-wait; returned mail may be unrelated to the request. |

Install/relink requests are guided workflows, not extra executable CLI modes. They also require help and collection of missing details before changes.

## Resolve an unloaded Claude chat

```sh
node scripts/ihcp.mjs resolve <harness-dir> <private-target.json>
```

Input fields are `session_id`, `harness`, `name`, `idempotency_key`, and the known project `cwd` when available. `found` returns the endpoint. For `wake_requested`, the agent handles the correlated reply and repeats resolution with `wake_request_id` and the returned `desktop_id` before sending the original work. It does not ask the user to poll. A live Claude Desktop session must be available as a relay; the standalone CLI cannot wake an unloaded desktop chat by itself.

## From a terminal

Run from the code folder. All modes accept `--help`, even before a runtime or session exists:

```sh
node scripts/ihcp.mjs --help
node scripts/ihcp.mjs remote_prompt --help
node scripts/ihcp.mjs unregister --help
node scripts/ihcp.mjs discover /absolute/private/harness
node scripts/ihcp.mjs remote_prompt /absolute/private/harness /absolute/private/request.json
```

Example `request.json`:

```json
{"session_id":"<source-native-id>","recipient":"<discovered-session-address>","body":"Review the supplied diff; do not edit files.","idempotency_key":"review-001"}
```

Include the actual material to review in the request, or an explicitly accessible file reference. The helper does not attach your current chat or diff automatically. An idempotency key identifies retries of the same request so they do not create duplicate work; use a new key for a different request.

The skill gets the source session ID from reliable native context and matches it to discovery. If unavailable, it asks the user to identify their source chat; this does not register the chat. Every mail/worker input includes that `session_id`.

The CLI returns a request ID, not an immediate answer. Agents use `status`, `check` and the reply workflow in [onboarding](onboarding.md) to handle the answer automatically. In conversation, show at most a brief “Checking with Codex.” followed by the useful answer; request IDs and delivery states belong in diagnostics, and users should not have to chase replies. Leading `/` is accepted for CLI mode names too, but the conversational `<session> <request>` shorthand is not CLI syntax: the CLI uses private directory and JSON-file paths.
