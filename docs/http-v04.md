# Optional Docker/HTTP deployment — v0.4 compatibility

This legacy option runs a local HTTP server in Docker instead of using the default process connection. A **waiter** waits for new mail without reading its contents; a **notification bridge** passes that signal to the receiving app. **Loopback** means connections stay on this computer (`127.0.0.1`). See [terminology](terminology.md) for the older protocol vocabulary.

This is the **versioned compatibility path**, not the v1.5.3 default. It retains the existing mail, attendance, directory, backup/restore and explicit wake-bridge capabilities. The current HTTP entrypoint uses the older exclusive-owner store; new correlated request and worker APIs belong to local stdio. A shared version string does not make their capabilities identical.

For the default installation, read [onboarding](onboarding.md). Never run HTTP and stdio against the same live database or accept normal traffic into two authorities for the same installation. Respect the installed app’s execution restrictions and report actual failures.

## Install and roles

Ask for a private runtime folder first. Use existing Node 24.15+ and Docker, with package installs/bundling in the pinned image and dependencies/caches in named volumes:

```sh
node scripts/dev.mjs prepare
node scripts/install.mjs /absolute/private/ihcp-http 43188 ihcp3k-example
```

This installer builds the container image, records its immutable image ID and provisions an exclusive SQLite owner in a named volume. Matching repeated installation verifies/reuses it. It is not the v1.5.3 shared local installer. Do not use public synthetic credentials for real mail.

The older `scripts/init-runtime.mjs <new-private-directory> alpha beta` creates static sender/receiver/waiter roles. It is an optional legacy initializer, not the directory enrolment workflow. Dynamic `ihcp.mjs enroll` uses the HTTP runtime manifest; `register` takes `http://127.0.0.1:43188/mcp` instead of a stdio runtime path.

Receiving credentials claim only their own inbox; sender credentials cannot claim; wake credentials see availability without bodies. The service runs non-root on loopback, with a read-only container filesystem and bounded resources. Stopping keeps its data volumes. No boot-time installer is implied.

## Native HTTP clients

Emit snippets for explicit native setup; do not silently change native configuration or restart an app. Header helpers read token files. Never run a helper into a transcript, copy its output into logs or put a token value on a command line.

Example Codex entry:

```toml
[mcp_servers.ihcp_send]
url = "http://127.0.0.1:43188/mcp"
http_headers_helper = 'node "/absolute/repo/scripts/headers.mjs" "/absolute/private/ihcp-http/tokens/alpha-sender.tok"'
startup_timeout_sec = 15
tool_timeout_sec = 45
```

Use an endpoint receiving credential only in its explicitly chosen scope. Sessions sharing a native scope may inherit that credential; same-account full-access sessions are not a hostile-client security boundary. Verify installed-version configuration and actual native tools independently. See the [versioned Claude HTTP guide](claude-setup.md).

The official-SDK fallback uses the same authority:

```sh
node service/dist/client.mjs http://127.0.0.1:43188/mcp /absolute/private/ihcp-http/tokens/alpha-pa.tok mail.status /absolute/private/status.json
```

The input contains `{"recipient":"alpha-pa"}`. Keep bodies/claim tokens private. A denial cannot be bypassed through this helper.

## Explicit wake adapters

Codex's older bridge uses a private JSON configuration with `url`, `token_file` (wake-only), `recipient`, absolute `cli` and exact native `thread`. Run only with an authorized, recorded process owner:

```sh
node scripts/codex-bridge.mjs /absolute/private/bridge.json
```

It waits, reserves one notification, queues without `--resume`, and records queued/uncertain status. It does not invoke a model or prove message consumption. An attached-session bridge ends with its owner; unattended startup and app-closed delivery are not guaranteed. Do not introduce scheduled AI polling.

Claude's background waiter is owned by the intended receiving session, exits on pending mail and must be rearmed after handling. Its task completion is a native notification only if that harness surfaces it correctly. See [Claude HTTP setup](claude-setup.md).

The legacy `exchange` helper wraps attendance, ordinary send, bounded wait and release. It returns possibly unrelated claims. v1.5.3 request correlation is not available through this compatibility store.

## Operations and historical rehearsal

```sh
node scripts/ops.mjs /absolute/private/ihcp-http/runtime.json status
node scripts/ops.mjs /absolute/private/ihcp-http/runtime.json backup before-upgrade.db
node scripts/ops.mjs /absolute/private/ihcp-http/runtime.json restore before-upgrade.db
```

Backup uses the SQLite backup API and records integrity/hash evidence. Restore creates a separate paused database; it does not replace the running one. Preserve newer state and reconcile effects before choosing a sole authority. The ops commands are HTTP/container operations, not commands for the local stdio manifest. Backup retention is manual.

The historical rehearsal uses `scripts/onboarding-smoke.mjs` with an explicitly rehearsal-named HTTP runtime. It does not validate new stdio behavior or notification delivery in the app. Historical evidence is labeled separately in [validation](validation.md); see [migration](migration.md) before an offline transition.
