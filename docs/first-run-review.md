# What first-time setup looks like

Start with [agent setup](../AGENT_SETUP.md). The assistant should guide the user through these choices rather than expect knowledge of earlier installations.

1. **Choose one folder.** The assistant asks “Where should the files be saved?” and handles the layout inside it. Later harnesses reuse that installation.
2. **Identify the harnesses.** Record the actual app versions and session IDs. A chat title alone may not uniquely identify a session. Record available models, permissions and the date each observation was made.
3. **Register and connect once per harness.** Grant reciprocal permission to peer harnesses. Automatically discover the native sessions; do not enrol them individually. Prepare the app's MCP (Model Context Protocol) settings in the chosen scope, then verify that the running session actually loads the tools.
4. **Try a harmless exchange.** Discover the other session, send a question, and match its reply to that request. Test notifications separately: queuing a notification does not prove the recipient read it.
5. **Review optional features.** Configure separate task workers only when requested, including their model, limits and history retention. Test disconnection with `/unregister` before relying on the setup.

Any discovered session can communicate with an allowed peer. There is no required management session or central message relay, and opening a new chat does not require another registration.

Every skill mode offers usage help when called alone or with `--help`; see [usage](usage.md). The assistant must explain limitations for unsupported harnesses rather than silently start another session or broaden permissions.

Skills and project memory remain in the user's chosen shared locations. Installation does not copy conversations, merge memories or transfer work ownership. A handover requires the original session to stop and the destination to confirm it can continue.

Worker history cleanup currently supports explicitly configured Codex workers only. It requires a successful result that has been acknowledged, verified process exit and the exact owned session ID. Cleanup runs while a runtime is active or at its next start, not at a guaranteed wall-clock time.

See [validation](validation.md) for observed behavior and remaining gaps, and [terminology](terminology.md) for the technical vocabulary.
