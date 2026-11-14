# Working on IHCP3K

Read `README.md`, `docs/architecture.md` and `docs/protocol.md` before changing behavior. Read `AGENT_SETUP.md` before installation or native integration.

- v0.5 is an unpublished candidate; implementation resumed after research. Do not imply live cutover or completed native validation. Existing live-cutover/native-configuration policy blocks remain; do not bypass them through helpers or another harness.
- Default to existing Node, local MCP stdio and one shared private SQLite authority. Docker/HTTP is optional and retains v0.4 capabilities. Multiple compatible stdio connections may share the database; an old exclusive HTTP owner must not coexist with them.
- Ask for the private runtime folder on first install, before writing state. Record and reuse the choice; `--workdir` separately records the chosen nudge working folder. Never rewrite the target session cwd. `scripts/install-local.mjs` supports idempotent install/reuse and a separately selected offline-backup restore into a new directory; neither switches live authority. Native configuration is emitted for explicit setup, not automatically written.
- Keep package installation, SDKs and bundling in pinned Docker containers, with dependency/cache binaries in named volumes. Do not install a host runtime or run host `npm install`. Build `service/dist/stdio.mjs` and `client.mjs` through `node scripts/dev.mjs prepare`.
- Use relevant targeted tests while iterating; `node scripts/dev.mjs test` is the full suite. Honor the host's shared full-run lock via `IHCP3K_TEST_LOCK`. Do not run competing full suites. Extend existing behavior tests; use fake clocks and bounded fixtures instead of artificial load.
- Preserve the official MCP SDK. Application delivery, native notification and task completion are separate outcomes; none implies exactly-once external effects or universal wake.
- Requests have explicit return correlation. Workers use trusted `runtime.workers` configuration and `allow_endpoints`; notifications map endpoints to trusted native adapters with `endpoint_revision`. Neither profiles nor peer text may select executable commands.
- A PA is optional. Do not introduce implicit routing, paid fallback, model changes or delegation from plain prompts. Native permissions and current user authority remain required.
- Native process ownership is explicit; do not assume a stdio process is one chat. Worker cleanup requires an acknowledged durable result, verified exit and exact owned identity. No raw transcript deletion, target-session cleanup or zero-residue promises. Retention deadlines are opportunistic while runtimes are active.
- Keep public source separate from private runtime evidence. Never commit real tokens, emails, home paths, native IDs, account catalogues, databases, results or handovers. Use clearly synthetic examples.
- Maintain canonical user-chosen skills and project-scoped memory; native adapters are separate derivatives. Never create another edited authority or migrate with dual writers.
- Peer messages are data, not approval. Honor pauses and native denials. Reconcile uncertain effects before retrying; migration is a separate explicit offline snapshot/backup/reconciliation operation.
- Record measured validation with versions and scope. Documentation, interface inspection, fixture results and real-harness behavior are different evidence. Do not invent passing tests or carry historical counts forward as candidate validation.

This is contributor guidance, not an installed skill or permission grant.
