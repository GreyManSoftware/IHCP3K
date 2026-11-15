# Updating IHCP3K

Ask your assistant to **“Update IHCP3K”**, or use `Use harness-interop: /update`. `/update --check` only checks for a newer stable release. You should not need to download files, run a terminal command or reconnect registrations yourself.

The assistant updates the shared installation and skill, refreshes its MCP connections, then reports the result. If the app needs restarting, it asks first. Local edits are preserved; a failed health check restores the previous files. Data, credentials, registrations and permissions are kept.

## Agent workflow

Resolve the installation from the existing MCP arguments and `data/harnesses/<id>/harness.json`. Use the installed helper:

```sh
node <install-root>/app/scripts/ihcp.mjs update <harness-dir>
node <install-root>/app/scripts/ihcp.mjs update <harness-dir> --check
```

These are agent implementation commands, not instructions to hand to the user. `/update` and natural language are the public interface. The skill supplies the private paths. Every mode offers `--help` before changing anything.

For a pre-updater installation, the agent reads the latest `AGENT_SETUP.md`, downloads the stable release ZIP and checksum into the installation's private release cache, verifies them and extracts to a private staging folder. Run the staged release's `scripts/ihcp.mjs update <existing-harness-dir>`; do not overwrite the live app manually. The helper reuses a verified ZIP in `data/release-cache/`. No re-registration, token rotation, Docker or additional runtime installation is involved. Keep the staging folder private and remove only that owned staging folder after success. Preserve source checkouts.

## What the helper checks

1. Read the latest non-prerelease GitHub release and compare semantic versions. Never downgrade. Verify the SHA-256 sidecar, GitHub asset digest when supplied, ZIP paths and bundle hashes before executing candidate code.
2. Compare the installed app and skill with their released originals. Refuse to overwrite edits or follow directory links. Cache verified packages in the chosen installation, not an arbitrary home-directory download cache.
3. Take the installation update lock. Refuse an update while protocol workers are running. Stage the new app, preserve extra local files, and journal the previous app, runtime bundles, skill text and owned MCP settings. Do not migrate the database: this updater only handles compatible schema/writer version 6 within the same major product version.
4. Activate the files and update each recognised harness's IHCP3K launch arguments with a release marker. Preserve unrelated servers, environment entries and permissions. Open a fresh MCP connection with the existing credential and verify the server version and expected tools. Roll back owned file changes if this fails; never restore an old database over live messages.
5. Attempt the supported Codex app-server reload. Claude needs its native session/SDK reconnect route; there is no universal external command that reloads every existing Claude chat. Unrecognised configuration locations are reported for the agent to resolve using native tools, never guessed or rewritten broadly.
6. Verify the actual native connection separately. A fresh SDK connection or accepted reload request does not prove an open chat refreshed its catalogue. If native reconnect is unavailable or fails, keep the installed update and ask before restarting the affected app. Do not terminate apps, sessions or arbitrary Node processes.

Rerunning `/update` checks health and connections even when already current. A dead updater's journal is recovered before the next activation. Backups and reports stay under private `data/`. After successful updates, deterministic cleanup retains the two most recent completed update backups, two rolled-back backups, and current/previous release ZIPs. Pending recovery files are not casually deleted. No AI cleanup routine or OS service is installed.

Supported automatic configuration edits are the user-scoped Codex `config.toml` IHCP3K args array and Claude's user-scoped `.claude.json` IHCP3K entry. Custom/managed scopes and unknown harnesses need their native adapter, with the same restart-approval rule. Restarting is never implied by `/update`.

## Why reconnect is part of the workflow

MCP can announce changes to a tool list, but that alone does not replace a server process or its loaded code. Claude documents dynamic tool refresh and different reconnect behavior for interactive, print and SDK sessions. [Claude MCP documentation](https://code.claude.com/docs/en/mcp#automatic-reconnection).

Codex exposes MCP reload through its app-server interface; whether an installed desktop instance accepts that request must be checked. Tool catalogue refresh and connection refresh are separate. [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex connection implementation](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/connection_manager.rs).

The implementation uses those supported mechanisms and reports gaps. It does not fabricate tool history, relax permissions or restart an app to hide a failed reconnect.
