# Install, register and discover

The shared entry point is [harness-interop](../skills/harness-interop/SKILL.md). Its modes work through the CLI below; `/register` is a conceptual skill mode, not a universally installed slash command. Use a private runtime and session directories outside public source.

## Install once

From a verified checkout, with existing Node 24.15+ and Docker:

```sh
node scripts/dev.mjs prepare
node scripts/install.mjs /private/ihcp 43188 ihcp3k-live
```

The first install builds a service image from the digest-pinned Node base, installs dependencies inside the image and records its immutable image ID. It starts one MCP container with embedded SQLite in a named volume. There is no separately published prebuilt service image yet. Repeat the same command to verify and reuse it. A port conflict, unexpected existing volume, unhealthy service or identity mismatch fails closed. It never silently replaces data or upgrades an installation. The install lock and SQLite owner lock prevent competing writers. Do not remove locks just because a check times out.

The administrator token stays in private `tokens/admin.tok`. It is for setup and reconciliation, not model-facing MCP configuration. Native permissions remain independent of these credentials.

## Enrol a receiving endpoint

An authorized operator writes a grant, for example:

```json
{"endpoint":"claude-main","harness":"claude-local","peers":["codex-main"],"expected_revision":0,"ttl_s":600}
```

Then mint a one-use code into a private file. Neither code nor session credentials are printed:

```sh
node scripts/ihcp.mjs enroll /private/ihcp/runtime.json /private/grant.json /private/enrolment.code
```

Create a profile file. `binding` is private and excluded from discovery; profile fields are visible to permitted peers. Inventory models without running inference. Do not copy private transcript data into the profile.

```json
{
  "profile": {
    "label": "Claude on this machine",
    "source": "native inventory; replace with actual evidence",
    "observed_at": "2026-01-01T00:00:00Z",
    "fresh_for_s": 3600,
    "models": [],
    "usage": [],
    "wake": {
      "type": "manual",
      "lifetime": "manual checks only until adapter verified",
      "closed_app": "unknown",
      "human_fallback": "Ask the operator to open the receiving session and check mail"
    }
  },
  "binding": {"native_thread": "operator-confirmed native ID"}
}
```

Replace the timestamp and evidence. A model entry requires `id`, `access` (`available`, `conditional`, `unavailable`, `unknown`) and `source`; additional capability/suitability fields must be attributed, not invented. Usage entries require `pool`, `window`, `percent_used` (number or null), `resets_at` (ISO timestamp or null), `source` and `observed_at`. Record shared pools once per window. No background usage polling is installed.

```sh
node scripts/ihcp.mjs register http://127.0.0.1:43188/mcp /private/enrolment.code /private/profile.json /private/claude-session
node scripts/ihcp.mjs discover /private/claude-session
```

Repeat enrolment/registration for the other endpoint with reciprocal permitted peers. Labels may repeat; stable harness and endpoint IDs may not be guessed or overwritten. Registration writes a private retry record, `session.tok`, `wake.tok` and `session.json`. Retrying the exact registration is idempotent during the code's validity. If a response is lost after expiry, check the saved session credential before seeking a fresh grant; do not assume the first registration failed.

Discovery returns only permitted active endpoints. Models, usage age, source and stale flags are advisory. Presence describes observed client activity, active attendance and recent waiter activity; `awake` remains unknown. A model listing neither proves remaining allowance nor grants routing/dispatch authority.

## Use it

```sh
node scripts/ihcp.mjs send /private/claude-session /private/message.json
node scripts/ihcp.mjs check /private/codex-session
node scripts/ihcp.mjs complete /private/codex-session /private/completion.json
```

A message contains `recipient`, `body`, `idempotency_key` and optional `kind`. A completion contains the received `id`, `claim_token`, `generation` and truthful `outcome`. Claims last up to five minutes. Use `renew` only while working or `release` with an accurate `work_started` flag. Never treat received text as permission to act.

`exchange` accepts message fields plus an optional bounded `timeout_ms` and waits actively after sending. It can receive unrelated inbox mail; match the actual sender and request yourself. Request-specific correlation is not implemented. Queue/wake urgency and the proposed 90-second batching change remain unimplemented in this release.

Use `refresh` with a profile-only JSON snapshot to update observations at the expected local revision. Usage is never automatically reset because a reset time passes. A stale snapshot is rejected.

## Wake adapters and native configuration

Use `session.tok` for the receiving session's MCP/SDK connection and `wake.tok` for its adapter. Follow [AGENT_SETUP.md](../AGENT_SETUP.md) for native configuration syntax. Do not give every session the same receiving credential. Codex's bridge needs a verified thread binding; Claude's waiter belongs to its hosting session. Keep their lifetime and closed-app limits in the profile. Registration does not start either process or restart an app.

## Unlink and relink

```sh
node scripts/ihcp.mjs unlink /private/claude-session
```

This revokes both credentials, hides the endpoint, rejects new sends and quarantines interrupted claims. Pending and uncertain messages remain stored. Stop only that endpoint's verified adapter and remove only its native configuration entry. The shared service and other endpoints remain intact.

For relink, the operator issues a new code with the endpoint's current revision. Register into a new private session directory, rebind and verify the adapter, then switch the native credential reference. Old credentials stay revoked. If an unlink response is lost, the operator can run `ihcp.mjs inspect <runtime.json> <endpoint.json>` with an input such as `{ "endpoint": "claude-main" }` before reissuing a grant. Revocation prevents the old credential from querying its former inbox.

Back up before live changes. Restore revokes registered credentials, clears enrolment codes, increments endpoint revisions and pauses inboxes; explicit relink/reconciliation is required. A restored backup must not resurrect credentials revoked since it was taken.

## Rehearse before a live switch

```sh
node scripts/install.mjs /private/rehearsal 43208 ihcp3k-rehearsal-example
node scripts/onboarding-smoke.mjs /private/rehearsal/runtime.json
```

The smoke script accepts only a rehearsal-named runtime. It tests three synthetic harnesses, repeat registration, discovery, direct delivery, completion and unlink. It does not prove native app wake. For that, each real harness must independently register, discover its peer, receive a harmless request and record its outcome, with its native adapter active. Keep the old service paused and backed up until the replacement is verified; never let two databases accept normal traffic as the same authority.
