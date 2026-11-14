# Technical terms

The README uses ordinary language. These definitions cover names found in the installation guides, configuration and protocol reference.

| Term | Meaning in IHCP3K |
| --- | --- |
| Harness | An application/account installation that runs an AI agent, such as Claude Code or Codex. It registers once; distinct accounts/hosts are distinct instances. |
| Native | The harness's own interface, commands, settings or permissions. |
| MCP | Model Context Protocol: the tool interface a harness uses to call IHCP3K operations. |
| Runtime | A running IHCP3K process. “Runtime folder” means its private configuration, database, credentials and executable bundles. |
| Stdio | Communication through a local process's standard input and output, without an HTTP server. |
| Endpoint | An IHCP3K session address, automatically derived from harness ID and native session ID. Legacy addresses can also be individually enrolled. It is not necessarily a network URL. |
| Binding | The recorded app, host and exact native session identity behind an endpoint. |
| Directory / discovery | The list of registrations a caller is permitted to see, with advertised models and dated usage observations. |
| Principal / scope | An authenticated identity, and the operations or recipients its credential allows. |
| Enrolment / grant | Legacy one-use permission for per-session registration. The current harness setup uses the operator credential once for a whole harness. |
| Adapter | Code that translates an IHCP3K operation into a harness-specific command. |
| Notification / wake | A signal telling an existing session that mail is waiting. It does not prove that the session read or completed the request. |
| Waiter | A program waiting for pending mail, without reading message bodies or repeatedly asking an AI model to check. |
| Worker | A separately launched session for an explicitly requested task, with configured limits. |
| Bounded | Limited by specified time, output size, turns or resource settings; the applicable bound must be stated. |
| Claim / lease | A temporary reservation allowing one handler to process a message. A lease expires at a recorded deadline. |
| Generation / revision / fencing | Increasing version numbers and checks that reject operations from an expired handler or outdated registration. |
| Attendance | A short reservation indicating that a session is actively waiting for mail; it suppresses redundant notifications. |
| Correlation | A stored link between a request and its reply, so unrelated messages aren't mistaken for answers. |
| Idempotency / deduplication | Recognising a retry as the same operation rather than creating another request. This does not guarantee exactly-once effects in an external system. |
| Reconciliation | Inspecting uncertain work and actual changes before deciding whether to retry, abandon or mark it complete. |
| Authority | The one active database/configuration chosen for an installation. Do not let separate copies accept work independently. |
| Cutover / barrier | Switching clients to a replacement installation / the agreed stop point before taking the old installation offline. |
| WAL | SQLite's write-ahead log. Recent committed data may be there rather than in the main database file, so copying only a running `.db` file is unsafe. |
| Tombstone | A small record retained after message content is cleared, to prevent duplicate processing. |
| Retention / no-persist | How long records or chat history are kept / a harness option to avoid persisting a worker's chat. Neither promises erasure of all logs or remote data. |
| Loopback | A network connection restricted to the same computer, typically `127.0.0.1`. |
| SDK / CLI / cwd / ACL | Software development kit / command-line interface / current working directory / access-control list (file permissions). |
| AHP | Agent Host Protocol, used by the experimental Copilot notification adapter. Live-host compatibility has not been validated. |
| Fixture / rehearsal | Controlled test inputs or simulated responses / an observed run of a particular real workflow. |
| Canonical source | The single maintained copy of a skill or project memory that adapters reference, rather than separate edited copies. |

An API may retain older names such as `wake.wait` or fields such as `cwd`. Documentation should explain those names rather than assume readers know the implementation history.
