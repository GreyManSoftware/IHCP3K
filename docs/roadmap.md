# Release scope

The MCP mail service, scoped credentials, native connection helpers, Codex doorbell, Claude waiter, backup/restore and offline legacy importer are implemented. Validation evidence is in [validation.md](validation.md).

Remaining work:

- Wider clean-machine and harness-version testing, including app-closed wake and OS-start recovery.
- Credential boundaries stronger than a shared OS account where needed.
- Automated backup retention and storage monitoring.
- Service-owned session/handover records, canonical knowledge adapters, fresh model catalogues and deterministic dispatch policy.
- Resource coordination with configurable CPU/GPU/memory thresholds.

The setup guide describes safe conventions for those future integrations. It does not claim the service already performs them.
