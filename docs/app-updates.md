# Native application updates

## App updates and retained inboxes (1.5.1)

The operator can update discovery and the public profile without unlinking the harness:

```text
node scripts/ihcp.mjs configuration <harness-dir>
node scripts/ihcp.mjs configure <harness-dir> <private-config.json>
node scripts/ihcp.mjs profile <harness-dir> <private-observation.json>
```

Read the authoritative revision with `configuration`; it returns no credential. Both write commands take `expected_revision`. `configure` takes explicit overrides for `discovery`, `profile` and `notification`, filling omitted fields from the current database state. `configure` and `profile` commit through administrator-only `harness.configure` in one revision-checked SQLite transaction. Existing registration files are initial connection and retry records; configuration edits do not rewrite them. They cannot change peers or credentials. Session addresses, inboxes, active claims and authenticated connections survive. An identical configure retry is harmless. After an interrupted observation, inspect the authoritative revision before retrying. Concurrent changed settings fail with `HARNESS_REVISION_CONFLICT`.

On Windows, an operator may pin an installed package family rather than one versioned install folder:

```json
{
  "expected_revision": 1,
  "discovery": {
    "type": "codex",
    "executable": "C:/Packages/Example.Codex_1/app/resources/codex.exe",
    "cwd": "E:/Private/interop/data",
    "executable_resolution": {
      "type": "windows-package",
      "package_family": "Example.Codex_publisher",
      "relative_path": "app/resources/codex.exe"
    }
  }
}
```

Use actual current-account `Get-AppxPackage` evidence for the family and relative executable. Resolution queries only that exact package family in the current account, requires one healthy package and an existing file inside it, and never falls back to PATH or another publisher. Discovery, notifications and one-off work use the same policy. Missing/ambiguous packages fail closed. Other platforms and non-packaged Claude installations use the operator-selected absolute executable, including a user-managed stable symlink; a changed path can be applied through configure. No cross-platform package resolver or automatic PATH search is claimed.

Codex model discovery uses the native, read-only `model/list` RPC. On the next explicit IHCP3K discovery or model lookup, the runtime checks the registered executable identity. It refreshes when the executable changes, on the first lookup or after an hour, so server-side model changes also appear. The managed updater makes one best-effort model-only refresh after verifying the new installation. Force refresh can also bring the check forward. A complete scan replaces the catalogue, adding new models and dropping removed ones. Failed or partial scans keep the last complete list, report it as stale and back off briefly. Model reads do not delay normal mail routing. Multiple connections share the catalogue and coordinate probes in SQLite. No background automation, model invocation, permission change, account switch or new registration is needed.

The optional `profile` command records a new manual snapshot, including the resolved executable's native version. It uses the same paginated observer for Codex and preserves dated usage records. Claude has no verified native catalogue interface here and retains its operator-supplied profile. Catalogue listings are advisory; they do not authorize work or guarantee entitlement at execution time.

`harness.health` reports per-harness scan age, stale/error state, executable errors and profile age without invoking models or starting discovery. A successful MCP handshake alone no longer implies healthy routing. Old scans are marked stale even when no caller has requested a refresh; discovery remains demand-driven with no new daemon or AI routine. Health also reports the model-catalogue timestamp/error and compares the loaded server version with the installed version, so an existing chat can tell whether it needs to reconnect.

A failed scan retains the last successful inventory. Previously known, active sessions can still claim/read their own inbox, renew/release/complete claims, inspect their own requests and answer existing correlated requests. Results identify retained access with `retained_identity` and `discovery_warning`. Unknown or successfully removed sessions remain denied; revoked tokens and reciprocal peer restrictions still apply. Reply access does not authorize a new send or a different recipient.

New work still requires successful fresh discovery. A stale known destination fails explicitly with `RECIPIENT_DISCOVERY_STALE:<cause>`; an own-harness failure reports its discovery cause. No new request is committed in either case. Existing correlated replies can return to retained active peers and remain durable if notification fails. A successful empty scan disables absent sessions normally. Existing pending mail is never discarded to repair discovery.

A notification with proof that the helper never launched can retry after a short delay. When a helper may already have sent a notification, its reservation remains uncertain until a claim or operator reconciliation. Upgrading or discovering again does not replay these potentially delivered notifications; pending mail remains available when the recipient checks its inbox.
