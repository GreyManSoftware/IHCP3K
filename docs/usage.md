# Using IHCP3K

A harness is the app running your assistant. Install the [harness-interop skill](../skills/harness-interop/SKILL.md) and connect your sessions using [agent setup](../AGENT_SETUP.md) first.

## In a conversation

Tell the assistant to use the skill, then give it a mode and the information it needs:

```text
Use harness-interop: /register this session
Use harness-interop: /discover sessions
Use harness-interop: /discover models
Use harness-interop: /remote_prompt codex-review Review this diff; do not edit files.
Use harness-interop: /status <request-id>
Use harness-interop: /unregister harness Codex
```

`codex-review` is a placeholder for an actual permitted session returned by discovery. A session can ask another session directly; no special management chat is needed. Model listings include their source and age, and do not prove that the model or allowance is still available.

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

`/prompt`, `/chat` and `/request` remain aliases. `/unlink <session>` is the session-only compatibility form of unregister.

## Disconnect a session or harness

- `/unregister session <identity>` revokes one session's registration.
- `/unregister harness <name>` asks the agent to revoke the selected harness's verified registrations and remove its recorded IHCP3K MCP connection settings. MCP (Model Context Protocol) is the interface that exposes IHCP3K tools inside the app.
- `/unregister` alone shows help. It never means “remove everything”.

The agent checks the exact identities and configuration scope, resolves active work, and stops only processes owned by the selected integration. It preserves other harnesses, unrelated settings, the source repository and shared message data. If permissions or missing credentials prevent part of the operation, it reports what remains. The command-line helper below only revokes one registration; configuration removal is an agent-guided operation.

## All modes

The skill also supports the lower-level modes below. Each must offer usage assistance. JSON inputs are private files used by the command-line interface, not text you need to construct for ordinary conversational use.

| Mode | Purpose / required information |
| --- | --- |
| `register` | Connect this session; collect its identity, profile and approved registration grant. |
| `discover` | List permitted sessions or their advertised models. |
| `remote_prompt` | Send a request to a named permitted session. |
| `status` | Inspect a request ID, or inbox counts with `status inbox`. |
| `unregister` | Disconnect an explicitly named session or harness. |
| `refresh` | Update this session's advertised profile and model/usage observations. |
| `check` | Claim waiting messages for handling; this is not a read-only status check. |
| `reply` | Reply using a request's current claim credentials. |
| `send` | Send a message without automatic request/reply tracking. |
| `complete` | Mark a claimed message handled, with its actual outcome. |
| `renew` | Extend an active claim's time limit. |
| `release` | Release a claim and say whether work started. |
| `worker` | Run an explicitly configured task in a separate session. |
| `worker-status` | Inspect a worker's recorded status/result. |
| `worker-ack` | Acknowledge a result after checking it. |
| `enroll` | Administrator: issue a one-use registration grant. |
| `inspect` | Administrator: inspect a registration. |
| `exchange` | Legacy send-and-wait; returned mail may be unrelated to the request. |

Install/relink requests are guided workflows, not extra executable CLI modes. They also require help and collection of missing details before changes.

## From a terminal

Run from the code folder. All modes accept `--help`, even before a runtime or session exists:

```sh
node scripts/ihcp.mjs --help
node scripts/ihcp.mjs remote_prompt --help
node scripts/ihcp.mjs unregister --help
node scripts/ihcp.mjs discover /absolute/private/session
node scripts/ihcp.mjs remote_prompt /absolute/private/session /absolute/private/request.json
```

Example `request.json`:

```json
{"recipient":"codex-review","body":"Review the supplied diff; do not edit files.","idempotency_key":"review-001"}
```

Include the actual material to review in the request, or an explicitly accessible file reference. The helper does not attach your current chat or diff automatically. An idempotency key identifies retries of the same request so they do not create duplicate work; use a new key for a different request.

The command returns a request ID, not an immediate answer. Use `status`, `check` and the reply workflow in [onboarding](onboarding.md). Leading `/` is accepted for CLI mode names too, but the conversational `<session> <request>` shorthand is not CLI syntax: the CLI uses private directory and JSON-file paths.
