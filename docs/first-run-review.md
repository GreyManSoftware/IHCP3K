# First-time setup and session roles

**The transport does not need management threads. The current installer assumes one PA inbox per harness.** Those are different things.

## What a new user does today

1. Provide existing Node.js 24.15+ and Docker, clone the repository, and give an agent `AGENT_SETUP.md`. Dependency installation and tests run in Docker.
2. Choose a private runtime directory and participating harness names. The initializer creates an inbox and PA, sender and waiter credentials for each harness, plus an administrator credential. It creates no chats.
3. Explicitly choose which existing threads manage those inboxes. Record native IDs; names alone are ambiguous. The Codex bridge's private `thread` setting identifies its destination. Claude's notification belongs to the session hosting its waiter.
4. Connect native MCP, or use the SDK client where live reload is unavailable. Ordinary sessions receive send-only access in the default setup. Inbox-reading access belongs in a dedicated PA scope; sharing a project folder can share that configuration.
5. Start the service and authorized wake adapters. Verify a harmless round trip reaches the intended threads, including after a service restart. Record process ownership and what survives closing the harness.
6. Teach the selected sessions where canonical skills, project memory and handovers live. These remain outside the message database; installation does not merge them automatically.

This is an agent-assisted technical setup, not one-click onboarding. Native CLI connections and a live migration were verified; a separate fresh Windows installation probe was blocked and remains unverified. Automatic OS startup and app-closed wake are also unverified. An attached bridge depends on its owning session remaining open.

## Which sessions can communicate?

| Question | Current behavior |
| --- | --- |
| How is the PA selected? | The user/operator chooses and binds a native thread. No election or discovery exists. |
| Must messages pass through a PA? | No service rule requires it. The default initializer happens to create only PA inboxes. |
| Can an ordinary session send? | Yes, to recipients allowed by its credential. Shared send-only credentials identify the harness principal, not the individual native thread. |
| Can it receive directly? | Only after its own inbox, claim scope and wake binding are explicitly configured. There is no self-registration workflow. |
| Can it read another session's inbox? | Not through scoped MCP tools. Full-access processes sharing an OS account are not strongly isolated from each other's credential files. |

## Recommended design

Allow **any explicitly registered session** to talk directly to permitted peers. Make management a role, not a transport requirement. PAs remain useful for budgets, model routing, resource scheduling and handovers; ordinary collaboration should not require two extra PA turns.

Next steps, not implemented by this release:

- A registration flow asks the user to confirm a native session ID, creates a logical endpoint and a separate credential, and proves its wake binding with a canary message.
- A directory exposes approved peers, supported message types, current wake capability and optional roles. A directory entry is not authority to execute a task.
- Explicit communication scopes govern who can send to whom. No automatic access to every conversation or reuse of PA credentials for workers.
- Endpoint lifecycle handles closed sessions, stale mappings, relinking and credential revocation. Messages remain durable when a receiver is offline.
- Request/reply correlation and cancellation prevent an unrelated inbox message being mistaken for an answer. Today's bounded attendance lease suppresses inbox notifications; it does not provide correlation.

The highest priorities are endpoint registration and reliable wake lifecycle. Automatically choosing a "manager" from thread titles would hide those gaps rather than solve them.
