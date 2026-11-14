# First-time setup and session roles

Version 0.4 introduces the shared [harness-interop skill](../skills/harness-interop/SKILL.md) and [installation workflow](onboarding.md). The isolated fresh-install rehearsal passed; the real two-harness reinstall remains incomplete. See [validation](validation.md).

1. With existing Node and Docker, the first installer creates private runtime state and a container built from a pinned base. Later installers verify identity and reuse that service.
2. An authorized local operator issues a short-lived enrolment code for an exact harness/endpoint and permitted peer set. The administrator credential never goes in ordinary session configuration.
3. Each harness inventories its models/capabilities without inference, records wake limitations and optional dated usage, then registers. A private binding records the chosen native thread; the service does not choose or create it.
4. Discovery lists permitted active endpoints and attributed model/usage observations. Stale readings stay visible with their age; they do not authorize dispatch or paid overflow.
5. Each receiving endpoint gets a distinct session credential and wake-only credential. Configure and verify its native adapter separately. Unknown harnesses can start with manual check mode.

A PA is an optional coordination role. Ordinary sessions can message each other directly once explicitly enrolled and scoped; management threads are not elected or required by the service. Registration does not give every existing chat access to every other chat. Human authorization still governs each communication/task.

Credentials restrict cooperative clients, not hostile processes with full access under the same OS account. Profiles are attributed data, not proof of entitlement or suitability. A listed endpoint need not be awake; discovery reports observed client/waiter activity and attendance separately.

Skills, agents and project memory remain in shared canonical files outside the database. Installation does not merge memories, transfer ownership or replicate sessions. Handovers still require source stop and destination acceptance.

Still manual: native session selection/binding, native configuration reload, adapter startup, allowance observation and actual task routing. Still unverified: app-closed wake and unattended OS-start recovery. Request-specific reply correlation is not implemented; active exchange can receive unrelated mail.
