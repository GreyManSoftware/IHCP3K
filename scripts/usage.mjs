// CLI help is available before opening any runtime or credential file.
export const commands = {
  update: ['<harness-dir> [--check]', 'Update the shared installation, skills and MCP connections; ask before any app restart. --check changes nothing.'],
  configuration: ['<harness-dir>', 'Read the authoritative harness configuration and revision without returning credentials. Administrator operation.'],
  configure: ['<harness-dir> <config.json>', 'Operator-only in-place discovery/profile update with expected_revision; preserves credentials, peers and inboxes.'],
  profile: ['<harness-dir> <observation.json>', 'Observe native version/models and apply in place; JSON contains expected_revision and optional discovery override. No model work.'],
  enroll: ['<runtime.json> <grant.json> <new-code-file>', 'Create a one-use registration grant; administrator operation.'],
  register: ['<runtime.json> <harness-config.json> <harness-dir>', 'Register a harness once; discover its native sessions automatically.'],
  'register-session': ['<runtime.json|url> <code-file> <profile.json> <new-session-dir>', 'Legacy session enrolment; not needed by harness registration.'],
  discover: ['<harness-dir> [query.json]', 'List connected sessions this identity may contact.'],
  resolve: ['<harness-dir> <target.json>', 'Resolve and wake a named target; use a PTY so an existing Claude desktop chat can be opened automatically when all chats are suspended.'],
  remote_prompt: ['<harness-dir> <request.json>', 'Send to an existing recipient, or run one nonpersistent worker on a registered harness and return its answer. New work JSON: {session_id,harness,prompt,allow_new_session:true,idempotency_key,working_folder?,model?,context?}. Read-only; 180-second default, 300-second maximum timeout_ms.'],
  'withdraw-wake': ['<harness-dir> <wake.json>', 'Withdraw your own never-claimed desktop wake request using its exact ID and original resolve key.'],
  status: ['<harness-dir> <source-session-or-request.json>', 'Check inbox counts, or one request when an ID file is supplied.'],
  check: ['<harness-dir> <source-session.json>', 'Claim waiting messages for this session to handle.'],
  reply: ['<harness-dir> <reply.json>', 'Reply to a claimed request.'],
  send: ['<harness-dir> <message.json>', 'Send an asynchronous message without request/reply tracking.'],
  complete: ['<harness-dir> <completion.json>', 'Mark a claimed message handled.'],
  renew: ['<harness-dir> <renewal.json>', 'Extend an active message claim.'],
  release: ['<harness-dir> <release.json>', 'Release a claim; report whether work started.'],
  refresh: ['<harness-dir>', 'Rescan permitted harnesses for new or removed sessions.'],
  unregister: ['<harness-dir>', 'Revoke a registered harness and all its discovered session addresses.'],
  inspect: ['<runtime.json> <endpoint.json>', 'Inspect a registration; administrator operation.'],
  worker: ['<harness-dir> <worker.json>', 'Run an explicitly configured task worker and wait within its limits.'],
  'worker-status': ['<harness-dir> <worker-id.json>', 'Inspect a worker result and state.'],
  'worker-ack': ['<harness-dir> <worker-id.json>', 'Acknowledge a worker result after inspecting it.'],
  exchange: ['<harness-dir> <request.json>', 'Send a correlated request and receive mail inside this tool call; match in_reply_to. Legacy endpoints retain ordinary send semantics.'],
  wait: ['<harness-dir> <source-session.json>', 'Receive and claim mail in a bounded tool call without sending again.'],
  listen: ['<harness-dir> <listener.json>', 'Target-owned native background task: wait without claiming, then exit on pending mail.'],
  unattend: ['<harness-dir> <attendance.json>', 'Release this session\'s listener lease using its returned token.']
};
export const aliases = {prompt:'remote_prompt',chat:'remote_prompt',request:'remote_prompt',unlink:'unregister',upgrade:'update'};
const minimumArgs = {'withdraw-wake':2,configure:2,profile:2,enroll:3,register:3,'register-session':4,remote_prompt:2,resolve:2,reply:2,send:2,complete:2,renew:2,release:2,inspect:2,worker:2,'worker-status':2,'worker-ack':2,exchange:2,wait:2,listen:2,unattend:2};
export function parseInvocation(args) {
  const raw=args[0]?.replace(/^\//,'');
  const globalHelp=!raw||['help','--help','-h','?'].includes(raw);
  const name=globalHelp?(args[1]?.replace(/^\//,'')):raw;
  const mode=aliases[name]??name;
  if(mode&&!Object.hasOwn(commands,mode))throw Error(`UNKNOWN_MODE: ${name}. Use --help to list commands.`);
  const rest=globalHelp?[]:args.slice(1);
  if(globalHelp||rest.some(a=>['--help','-h','?'].includes(a))||rest.length<(minimumArgs[mode]??1)){
    const entries=mode?[[mode,commands[mode]]]:Object.entries(commands);
    const lines=['IHCP3K command usage','',...entries.flatMap(([key,[syntax,description]])=>[
      `node scripts/ihcp.mjs ${key} ${syntax}`,`  ${description}`]),'',
      'Add --help to any command. Paths are placeholders; use your configured private paths.',
      'Aliases: prompt/chat/request → remote_prompt; unlink → unregister; upgrade → update.',
      'Mail/worker JSON includes session_id: the source native ID from discovery, not a separate registration.',
      'CLI unregister revokes the harness. The skill also removes its recorded native MCP configuration.'];
    return {help:true,mode:mode??null,text:lines.join('\n')};
  }
  const unknown=rest.find(a=>a.startsWith('-')&&!(mode==='update'&&a==='--check'));
  if(unknown)throw Error(`UNKNOWN_OPTION: ${unknown}. Supported help options: --help, -h, ?.`);
  if(mode==='update'&&!rest.filter(a=>a!=='--check').length)return parseInvocation(['update','--help']);
  if(mode==='update'&&rest.filter(a=>a!=='--check').length!==1)throw Error('UPDATE_REQUIRES_HARNESS_DIRECTORY');
  return {help:false,mode,args:mode==='update'?rest.filter(a=>a!=='--check'):rest,...(mode==='update'?{check:rest.includes('--check')}:{})};
}
