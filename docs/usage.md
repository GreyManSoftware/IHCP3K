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
| `remote_prompt` | Ask an existing chat or run one-off work in a registered harness. |
| `status` | Inspect a request ID, or inbox counts with `status inbox` (the skill supplies the current source ID). |
| `update` | Update the shared runtime, skill and MCP connections; `--check` changes nothing. The conversational form needs no path. |
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
| `exchange` | Send and receive inside a tool call; match the correlated reply. Legacy endpoints retain ordinary send. |
| `wait` | Continue receiving inside a bounded tool call without resending. |
| `listen` | Receiving-chat-owned background task; exit on pending mail without claiming it. |
| `unattend` | Release this session's listener token. |

Install/relink requests are guided workflows, not extra executable CLI modes. They also require help and collection of missing details before changes.

## Resolve an unloaded Claude chat

```sh
node scripts/ihcp.mjs resolve <harness-dir> <private-target.json>
```

Input fields are `session_id`, `harness`, `name`, `idempotency_key`, and the known project `cwd` when available. `found` returns the endpoint. For `wake_requested`, the agent handles the correlated reply and repeats resolution with `wake_request_id` and the returned `desktop_id` before sending the original work. It does not ask the user to poll. Inspect `native_notification` if a relay remains pending; uncertain dispatch is not receipt. To change routes after verifying an exact direct target, the original requester may use `withdraw-wake <harness-dir> <wake.json>` with `{session_id,id,idempotency_key}`. `id` is the pending resolver request ID and `idempotency_key` is the original resolve key without the `resolve:` prefix. Only a never-claimed desktop relay request is withdrawable. The operation does not reset a native wake or withdraw project work. Agents run this helper with their host’s PTY option (for example `exec_command` with `tty:true`), so it can open a verified existing desktop chat automatically even if none is running. `desktop_open_requires_tty` means rerun the same request in a PTY, not hand a command to the user. Missing PTY support, unknown metadata, identity changes and ambiguous targets are explicit limitations; never change the idempotency key to retry an uncertain open.

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

For an existing destination chat, the CLI returns a request ID, not an immediate answer. Agents use `status`, `check` and the reply workflow in [onboarding](onboarding.md) to handle the answer automatically. In conversation, show at most a brief “Checking with Codex.” followed by the useful answer; request IDs and delivery states belong in diagnostics, and users should not have to chase replies. Leading `/` is accepted for CLI mode names too, but the conversational `<session> <request>` shorthand is not CLI syntax: the CLI uses private directory and JSON-file paths.

## One-off work without an existing chat

> /remote_prompt Claude Review this design in a new one-off session and return the findings here.

The skill supplies the context and starts one worker directly. No matching chat or relay is needed. The same CLI `remote_prompt` command accepts this alternative JSON:

```json
{
  "session_id": "<source-native-id>",
  "harness": "claude",
  "prompt": "Review the supplied function for concurrency bugs.",
  "context": "<function and relevant assumptions>",
  "working_folder": "/projects/example",
  "permissions": "read-only",
  "allow_new_session": true,
  "idempotency_key": "one-off-review-001"
}
```

`working_folder` is optional and defaults to the install root. Optional `model` selects exactly that model; otherwise the native default applies. `timeout_ms` defaults to 180,000, with a 300,000 maximum. Omit `recipient`. This route supports Claude/Codex read-only work; write access and other harnesses are unsupported. Missing models, authentication, allowance or native policy support produce failures, not fallback spending or another model.

Unlike mail to an existing chat, this call waits and returns the durable worker result, including `result.answer` on completion. The job ID and source `reply_to` correlate the answer. Native MCP uses `session.remote_prompt` then `session.worker_wait/status` on the same connection. Connection closure cancels owned work. Inspect the original job after interruption; uncertainty is not permission to retry. Reuse the same idempotency key for identical requests.

After preserving the result, use `worker-ack` with `{session_id,id}`. Inspect it using `worker-status` with those fields, or `status` with `{session_id,worker_id}`. Native sessions are nonpersistent; no existing chat is archived. Native logs/account retention may remain. Durable job records follow [automatic retention](retention.md).

## Receive quietly inside a tool call

For agents awaiting an answer, use `session.exchange` with the normal request fields and optional `timeout_ms` (up to 25,000). Continue with `session.wait` if the reply takes longer; do not send the request again. Match each reply's `in_reply_to` and complete its claim. Other mail can arrive in the same result.

The CLI equivalents are:

```sh
node scripts/ihcp.mjs exchange <harness-dir> <request.json>
node scripts/ihcp.mjs wait <harness-dir> <source-session.json>
```

The wait file contains `{"session_id":"<source-native-id>","timeout_ms":25000}`. Source identity and credentials are unchanged. New tools may require the harness's supported MCP reconnect. A closed old transport can use the bundled client fallback documented in the skill; it is a real shell-tool result, not proof that native MCP tools have reloaded.

For native Claude background tasks, `listen` accepts `{"session_id":"<source-native-id>","duration_ms":3600000}`. Start it from the receiving session's own background-task API, never as an unrelated detached process. It exits with a pending count and attendance token; the native completion event lets the owner claim its inbox. `unattend` takes that source ID and token. Help is available for every command. See [native adapters](native-adapters.md#quiet-delivery-and-native-ui-limits) for the idle Codex fallback and timeout behavior.
