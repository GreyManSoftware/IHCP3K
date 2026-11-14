# Using IHCP3K

A harness is the app running your assistant. Install the [harness-interop skill](../skills/harness-interop/SKILL.md) and register your harnesses once using [agent setup](../AGENT_SETUP.md) first.

## In a conversation

Tell the assistant to use the skill, then give it a mode and the information it needs:

```text
Use harness-interop: /register Codex
Use harness-interop: /discover sessions
Use harness-interop: /discover models
Use harness-interop: /remote_prompt codex-review Review this diff; do not edit files.
Use harness-interop: /status <request-id>
Use harness-interop: /unregister Codex
```

`codex-review` is a placeholder for an actual permitted session returned by discovery. Each harness registers once and its sessions are discovered automatically. A session can ask another session directly; no special management chat is needed. Model listings include their source and age, and do not prove that the model or allowance is still available.

These are instructions interpreted by the skill. They do not install native slash commands or autocomplete. Where the app treats a leading `/` specially, use the full `Use harness-interop: ...` form. Plain-language requests work too.

## Help before action

Every mode supports a bare invocation, `--help`, `-h` or `?`. The assistant must explain purpose, arguments and an example before taking action. Missing required details also trigger assistance. Help does not send mail, register or disconnect anything, claim messages, edit configuration, acknowledge results or start work.

```text
Use harness-interop: /remote_prompt
Use harness-interop: /remote_prompt --help
Use harness-interop: /unregister --help
```

For `/remote_prompt`, help can show the actual permitted destinations from your configured connection. If no connection exists, it explains registration instead. An ambiguous session label must be resolved before sending. The syntax is:

```text
/remote_prompt <session> <request>
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
| `remote_prompt` | Send a request to a named permitted session. |
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

The command returns a request ID, not an immediate answer. Use `status`, `check` and the reply workflow in [onboarding](onboarding.md). Leading `/` is accepted for CLI mode names too, but the conversational `<session> <request>` shorthand is not CLI syntax: the CLI uses private directory and JSON-file paths.
