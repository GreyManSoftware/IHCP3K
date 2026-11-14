// CLI help is available before opening any runtime or credential file.
export const commands = {
  enroll: ['<runtime.json> <grant.json> <new-code-file>', 'Create a one-use registration grant; administrator operation.'],
  register: ['<runtime.json|url> <code-file> <profile.json> <new-session-dir>', 'Register one session using an approved enrolment code.'],
  discover: ['<session-dir> [query.json]', 'List connected sessions this identity may contact.'],
  remote_prompt: ['<session-dir> <request.json>', 'Send a request to an existing session; return its ID.'],
  status: ['<session-dir> [request-id.json]', 'Check inbox counts, or one request when an ID file is supplied.'],
  check: ['<session-dir>', 'Claim waiting messages for this session to handle.'],
  reply: ['<session-dir> <reply.json>', 'Reply to a claimed request.'],
  send: ['<session-dir> <message.json>', 'Send an asynchronous message without request/reply tracking.'],
  complete: ['<session-dir> <completion.json>', 'Mark a claimed message handled.'],
  renew: ['<session-dir> <renewal.json>', 'Extend an active message claim.'],
  release: ['<session-dir> <release.json>', 'Release a claim; report whether work started.'],
  refresh: ['<session-dir> <profile.json>', 'Update this registration’s advertised information.'],
  unregister: ['<session-dir>', 'Revoke this session registration. Harness-wide disconnection is handled by the skill.'],
  inspect: ['<runtime.json> <endpoint.json>', 'Inspect a registration; administrator operation.'],
  worker: ['<session-dir> <worker.json>', 'Run an explicitly configured task worker and wait within its limits.'],
  'worker-status': ['<session-dir> <worker-id.json>', 'Inspect a worker result and state.'],
  'worker-ack': ['<session-dir> <worker-id.json>', 'Acknowledge a worker result after inspecting it.'],
  exchange: ['<session-dir> <message.json>', 'Legacy send-and-wait operation; returned mail may be unrelated.']
};
export const aliases = {prompt:'remote_prompt',chat:'remote_prompt',request:'remote_prompt',unlink:'unregister'};
const minimumArgs = {enroll:3,register:4,remote_prompt:2,reply:2,send:2,complete:2,renew:2,release:2,refresh:2,inspect:2,worker:2,'worker-status':2,'worker-ack':2,exchange:2};
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
      'Aliases: prompt/chat/request → remote_prompt; unlink → unregister.',
      'CLI unregister affects one session. Use the skill to disconnect an entire harness and remove its MCP configuration.'];
    return {help:true,mode:mode??null,text:lines.join('\n')};
  }
  const unknown=rest.find(a=>a.startsWith('-'));
  if(unknown)throw Error(`UNKNOWN_OPTION: ${unknown}. Supported help options: --help, -h, ?.`);
  return {help:false,mode,args:rest};
}
