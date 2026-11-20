# Native application updates

## App updates and retained inboxes (1.4.0)

The operator can update discovery and the public profile without unlinking the harness:

```text
node scripts/ihcp.mjs configure <harness-dir> <private-config.json>
node scripts/ihcp.mjs profile <harness-dir> <private-observation.json>
```

Both private JSON inputs require `expected_revision` from the current harness record. `configure` accepts `discovery`, `profile` and optional `notification`; omitted fields retain the recorded settings. It calls administrator-only `harness.configure`, applies a revision-checked transaction, then saves local retry evidence. It cannot change peers or credentials. Session addresses, inboxes, active claims and existing authenticated connections survive. An identical configure retry is harmless; concurrent changed settings fail with `HARNESS_REVISION_CONFLICT`. Revocation and relink still require their existing lifecycle operations. A lost profile-operation response can be reconciled by discovery and the recorded native observation; never unlink to clear a conflict.

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

`profile` obtains the resolved executable's native version, then for Codex reads every page of `model/list` through the selected stdio/proxy transport. It never reads chat history, starts work, changes accounts or spends on model inference. Existing usage records retain their original timestamps. No verified Claude model-list interface is implemented: its retained catalogue is explicitly marked unknown. Run profile after a native app/model change, or when catalogue freshness expires; new models need a profile observation, not registration or token rotation. Native failures do not overwrite the last profile. Profile metadata is advisory and does not authorize dispatch.

`harness.health` reports per-harness scan age, stale/error state, executable errors and profile age without invoking models or starting discovery. A successful MCP handshake alone no longer implies healthy routing. Old scans are marked stale even when no caller has requested a refresh; discovery remains demand-driven with no new daemon or AI routine.

A failed scan retains the last successful inventory. Previously known, active sessions can still claim/read their own inbox, renew/release/complete claims, inspect their own requests and answer existing correlated requests. Results identify retained access with `retained_identity` and `discovery_warning`. Unknown or successfully removed sessions remain denied; revoked tokens and reciprocal peer restrictions still apply. Reply access does not authorize a new send or a different recipient.

New work still requires successful fresh discovery. A stale known destination fails explicitly with `RECIPIENT_DISCOVERY_STALE:<cause>`; an own-harness failure reports its discovery cause. No new request is committed in either case. Existing correlated replies can return to retained active peers and remain durable if notification fails. A successful empty scan disables absent sessions normally. Existing pending mail is never discarded to repair discovery.
