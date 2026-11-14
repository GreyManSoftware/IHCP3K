# Install, register and discover

**v0.5 candidate; native validation and live cutover pending.** The shared [harness-interop skill](../skills/harness-interop/SKILL.md) uses the commands below. Mode names are not universally installed slash commands. Respect current native execution restrictions and record actual failures; do not infer a universal restriction from an earlier deployment batch.

## Choose the folder first

On first install, **ask the user to choose a private runtime folder before writing state**. On relink, show and reuse the recorded choice unless migration is requested. Record harness/engine versions, native host/server and stable session binding, model/access evidence, privileges, canonical knowledge locations and worker cleanup choice. See [AGENT_SETUP.md](../AGENT_SETUP.md).

Every path below is a placeholder. Replace it with the chosen absolute path; keep the parent directory existing and private outputs out of public commits. An installer does not infer user consent from an example path.

The chosen working folder is separate from private runtime state. `--workdir` records `runtime.working_directory`; without it, the private folder is used. Reuse the same option on subsequent installs when the folders differ. Throwaway nudges run in that working folder; targets and explicit task workers retain their own registered/configured cwd.

## Install local stdio

Use existing Node 24.15+; do not install a missing host runtime. From a source checkout, build the two bundles in pinned Docker containers:

```sh
node scripts/dev.mjs prepare
node scripts/install-local.mjs /absolute/private/ihcp --workdir /absolute/chosen/working-folder
```

`prepare` writes `service/dist/stdio.mjs` and `service/dist/client.mjs`; dependencies and caches remain in named Docker volumes. With matching prebuilt bundles, local installation/runtime needs no running Docker service.

The installer creates `runtime.json`, `service.json`, `tokens/admin.tok`, copied `bundles/stdio.mjs` and `bundles/client.mjs`, and `mail.db` in the selected private directory. It establishes private permissions before secrets and verifies service/schema identity and bundle hashes. Fresh install starts a temporary SDK connection; reuse checks the recorded installation without launching a runtime or activating notifications/workers. `notifications` and `workers` begin empty. No native configuration is auto-written, no background daemon is installed, and no existing live state is imported by ordinary installation.

Repeat the same command to verify and reuse a matching installation. A mismatched schema/identity, changed bundle, incomplete directory, widened permissions or competing install fails for review. Do not delete locks or overwrite private state to force reuse. Ordinary reuse is not an upgrade. The optional offline-backup form requires a new destination and explicit reconciliation; see [migration](migration.md).

For the optional older transport, use the separate [v0.4 Docker/HTTP guide](http-v04.md). Do not attach it to this database.

## Enrol a receiving endpoint

An authorized operator writes a private grant. These endpoint names are synthetic:

```json
{"endpoint":"alpha-main","harness":"alpha-local","peers":["beta-main"],"expected_revision":0,"ttl_s":600}
```

Mint the one-use code to a new private file:

```sh
node scripts/ihcp.mjs enroll /absolute/private/ihcp/runtime.json /absolute/private/grant.json /absolute/private/enrolment.code
```

The administrator credential stays outside model-facing native configuration. The wrapper writes the enrolment secret to a file rather than printing it.

Create a private profile/binding file:

```json
{
  "profile": {
    "label": "Example receiving session",
    "source": "Replace with actual native inventory evidence",
    "observed_at": "2026-01-01T00:00:00Z",
    "fresh_for_s": 3600,
    "models": [],
    "usage": [],
    "wake": {
      "type": "manual",
      "lifetime": "Manual checks until the native adapter is verified",
      "closed_app": "unknown",
      "human_fallback": "Open the bound session and check its inbox"
    }
  },
  "binding": {"native_session_id": "<operator-confirmed ID>", "host": "<verified owning host/server>"}
}
```

Replace the evidence and timestamp. Model entries require `id`, `access` (`available`, `conditional`, `unavailable`, `unknown`) and `source`. Usage entries require `pool`, `window`, `percent_used` (number or null), `resets_at` (ISO timestamp or null), `source` and `observed_at`. Record shared pools once per window. Optional profile fields include `capabilities`, `adapter_version`, `native_version` and `account_scope`; publish only information appropriate for permitted peers. Store exact identity and private evidence in private records. Bindings are excluded from discovery and are never executable adapter configuration.

```sh
node scripts/ihcp.mjs register /absolute/private/ihcp/runtime.json /absolute/private/enrolment.code /absolute/private/profile.json /absolute/private/alpha-session
node scripts/ihcp.mjs discover /absolute/private/alpha-session
```

Enrol/register the peer with reciprocal permissions. Each registration saves a private retry record, `session.tok`, `wake.tok` and `session.json`. An exact retry is idempotent while the code is valid. After a lost response/expired code, reconcile the saved credential and operator inspection before requesting a new grant.

Discovery returns permitted active endpoints with source, age and staleness. Presence does not prove a target is awake. Model listing or remaining allowance does not authorize dispatch, spending or a model change. No background AI usage polling is installed.

## Prepare native setup and notifications

Emit the scoped native snippet described in [AGENT_SETUP.md](../AGENT_SETUP.md) for explicit setup. Do not install it automatically or treat file generation as a loaded connection. Verify transport, tools, native permission scope and endpoint identity under the installed harness version.

Use the [harness-specific setup checks](native-setup.md) for scope and first-use approval. A fixed receiving token in global configuration is shared by every session loading that configuration.

Configure trusted `runtime.notifications` separately, keyed by endpoint with `endpoint_revision`, using the [adapter contract](native-adapters.md). The private directory binding/profile is evidence, not executable configuration. A runtime checks configured mail without AI polling; an appropriate native adapter handles the doorbell. A short CLI call does not leave a notifier running after it exits. A persistent native MCP connection or another explicitly owned active runtime is needed for ongoing delivery.

In stdio, `mail.send`, `mail.request` and `mail.reply` commit first, then await the configured bounded notification before returning (`timeout_ms` capped at 30000, with bounded shutdown). The response includes `native_notification` dispatch status, never proof of target receipt. A one-shot CLI therefore attempts its configured nudge before closing. Mail stays durable if notification fails; retry only with the original idempotency key. The active-runtime timer remains for pending recovery. Notifications are disabled until explicitly configured.

## Send a request and receive its reply

Create a private request file:

```json
{"recipient":"beta-main","body":"Answer the authorized question and reply here.","idempotency_key":"example-request-1"}
```

```sh
node scripts/ihcp.mjs chat /absolute/private/alpha-session /absolute/private/request.json
node scripts/ihcp.mjs check /absolute/private/beta-session
```

`chat` and `request` both call `mail.request`. They return the durable message/request ID and derived `reply_to`, not a completed answer. They do not route a plain prompt, select a model or start a worker. The receiver's claimed request includes its claim token/generation and return correlation.

After completing authorized work, create a private reply file with `id`, `claim_token`, `generation`, `body`, a stable `idempotency_key` and optional truthful `outcome`:

```sh
node scripts/ihcp.mjs reply /absolute/private/beta-session /absolute/private/reply.json
node scripts/ihcp.mjs status /absolute/private/alpha-session /absolute/private/request-id.json
node scripts/ihcp.mjs check /absolute/private/alpha-session
node scripts/ihcp.mjs complete /absolute/private/alpha-session /absolute/private/completion.json
```

`request-id.json` contains `{"id":"<returned request UUID>"}`. With no input file, `status` reports the endpoint's inbox status. `reply` atomically enqueues the correlated response and completes the original request. Claimed responses carry `in_reply_to`; inspect the real sender/result and complete their claim separately. Completion uses `id`, `claim_token`, `generation`, `outcome`.

`send` remains ordinary asynchronous mail. The legacy `exchange` helper attends the inbox and uses `mail.send`; it can return unrelated mail and does not add v0.5 correlation. For correlated active waiting, use `mail.attend` → `mail.request` → bounded `mail.wait` → `mail.unattend`, then match `in_reply_to`. Never assume the first claimed message is the answer.

## Run a configured worker

After explicitly configuring and validating a trusted worker adapter, create a private input:

```json
{"adapter":"example-reader","prompt":"Perform the authorized read-only task.","idempotency_key":"example-worker-1"}
```

```sh
node scripts/ihcp.mjs worker /absolute/private/alpha-session /absolute/private/worker.json
node scripts/ihcp.mjs worker-status /absolute/private/alpha-session /absolute/private/worker-id.json
node scripts/ihcp.mjs worker-ack /absolute/private/alpha-session /absolute/private/worker-id.json
```

`worker-id.json` contains the returned job `id`. Preserve and inspect the result before running `worker-ack`; the helper does not acknowledge automatically. `worker` holds its connection through `worker.wait` calls (each at most 25 seconds), with an optional overall `timeout_ms` in its input, default 330000. That client wait limit is separate from the trusted native process timeout.

Closing a stdio connection aborts workers owned by that runtime. A wait timeout/disconnect requires status inspection and reconciliation, not a second job with a new key. A one-shot generic client call to `worker.start` is unsuitable for detached work. See [retention and adapters](native-adapters.md).

## Refresh, unlink and relink

`refresh` takes a profile-only JSON snapshot and uses the locally recorded expected revision. Older observations are rejected; passed reset times do not invent new allowance. Refresh increments the endpoint revision: review/update the trusted notification binding before expecting further doorbells.

```sh
node scripts/ihcp.mjs unlink /absolute/private/alpha-session
```

Unlink revokes both credentials, hides the endpoint and quarantines interrupted claims, while retaining unresolved mail. Stop only verified owned processes and remove only explicitly installed native entries. Unlink is not a worker-cleanup or shared-database deletion command.

Relink needs a fresh enrolment at the current revision and a new private session directory. Rebind and validate native delivery before explicitly switching configuration. Operator `inspect <runtime.json> <endpoint.json>` can reconcile a lost unlink/registration response. Restore also requires relink and review; it must not resurrect revoked credentials.

Use isolated synthetic endpoints for rehearsal. The historical `onboarding-smoke.mjs` exercises Docker/HTTP; it is not evidence of v0.5 stdio or native behavior. Candidate results remain pending in [validation](validation.md).
