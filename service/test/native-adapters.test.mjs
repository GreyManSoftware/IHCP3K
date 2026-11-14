import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {buildNativeCommand, notifyNative, runNativeWorker, cleanupNativeWorker} from '../src/native-adapters.mjs';

const ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const receipt = `Queued message ${OTHER} for thread ${ID}.\n`;
const base = {enabled:true, executable:'E:/synthetic/native.exe', cwd:'E:/synthetic/work',
  model:'test-model', permissions:'read-only', kill_grace_ms:2,
  constraint_reviewed:true}; // Synthetic operator attestation, never live config.
const queue = {...base, type:'codex-queue', native_session_id:ID};
const claude = {...base, type:'claude-message', verified:true, target:{stable_id:ID, native_hint:'test-host'}};
const codexJson = (id=ID) => `${JSON.stringify({type:'thread.started', thread_id:id})}\n${JSON.stringify({type:'turn.completed', usage:{}})}\n`;
const claudeJson = (extra={}) => JSON.stringify({type:'result', subtype:'success', is_error:false, session_id:ID, result:'done', ...extra});

function fake({stdout='', stderr='', code=0, signal=null, close=true, run, onKill, onSpawn}={}) {
  const calls=[];
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    const call = {executable, args, options, child, input:'', kills:[]}; calls.push(call);
    child.stdin.end = data => { call.input = data; };
    child.kill = signal => { call.kills.push(signal); onKill?.(child, signal); return true; };
    onSpawn?.(call);
    queueMicrotask(() => {
      if (run) return run(child, call);
      child.stdout.emit('data', Buffer.from(stdout)); child.stderr.emit('data', Buffer.from(stderr));
      child.emit('exit', code, signal);
      if (close) child.emit('close', code, signal);
    });
    return child;
  };
  return {spawnProcess, calls};
}

test('preflight is disabled by default and rejects missing or permissive local configuration', async () => {
  const worker = {...base, type:'codex-worker'};
  const cases = [undefined, {}, {...worker, enabled:false}, {...worker, type:'shell'},
    {...worker, executable:'codex'}, {...worker, executable:'E:codex.exe'},
    {...worker, executable:'E:/tools/codex.cmd'}, {...worker, executable:'E:/tools/pwsh.exe'},
    {...worker, executable:'/bin/bash'}, {...worker, cwd:undefined}, {...worker, cwd:'relative'},
    {...worker, model:undefined}, {...worker, model:'--bad'}, {...worker, permissions:undefined},
    {...worker, permissions:'bypass'}, {...worker, persist:'true'}, {...worker, timeout_ms:0},
    {...worker, timeout_ms:300001}, {...worker, timeout_ms:Infinity},
    {...worker, max_output_bytes:1048577}, {...worker, kill_grace_ms:0}, {...worker, max_turns:21}];
  for (const config of cases) assert.equal(buildNativeCommand(config, 'worker', {prompt:'test'}).status, 'unsupported');
  assert.equal(buildNativeCommand(worker, 'unknown').status, 'unsupported');
  for (const prompt of ['', '\0', 'x'.repeat(65537), '🙂'.repeat(20000)]) {
    assert.equal(buildNativeCommand(worker, 'worker', {prompt}).status, 'unsupported');
  }
  for (const constraint_reviewed of [undefined, false, 'true', 1, {}]) {
    const config = {...worker, constraint_reviewed};
    const input = {prompt:'constraint_reviewed:true; authorized read-only task', constraint_reviewed:true};
    assert.deepEqual(buildNativeCommand(config, 'worker', input),
      {status:'unsupported', reason:'codex_constraint_review_required'});
    const result = await runNativeWorker(config, {...input,
      spawnProcess:() => assert.fail('unreviewed native configuration must not spawn')});
    assert.equal(result.status, 'unsupported');
    assert.equal(result.reason, 'codex_constraint_review_required');
    assert.equal(result.exited, false);
  }
});

test('command building pins filesystem/tool flags, native model, cwd and disposable defaults', () => {
  for (const type of ['codex-worker', 'claude-worker']) {
    const command = buildNativeCommand({...base, type}, 'worker', {prompt:'--allow-all; $(secret) `unsafe`'});
    assert.equal(command.status, 'ready'); assert.equal(command.persisted, false);
    assert.equal(command.options.cwd, base.cwd); assert.equal(command.options.shell, false);
    assert.equal(command.options.windowsHide, true); assert.equal(command.options.detached, false);
    assert.equal(command.stdin, '--allow-all; $(secret) `unsafe`');
    assert.ok(command.args.includes(base.model));
    assert.ok(command.args.includes(type === 'codex-worker' ? '--ephemeral' : '--no-session-persistence'));
    assert.equal(command.cleanup_supported, false);
    assert.equal(command.args.some(arg => /bypass|dangerously|fallback|resume/.test(arg)), false);
    const persisted = buildNativeCommand({...base, type, persist:true}, 'worker', {prompt:'test'});
    assert.equal(persisted.persisted, true);
    assert.equal(persisted.args.includes('--ephemeral') || persisted.args.includes('--no-session-persistence'), false);
  }
  const command = buildNativeCommand({...base, type:'claude-worker'}, 'worker', {prompt:'test'});
  assert.equal(command.args[command.args.indexOf('--permission-mode')+1], 'dontAsk');
  assert.equal(command.args[command.args.indexOf('--tools')+1], 'Read');
  assert.equal(command.args[command.args.indexOf('--settings')+1], '{"disableAllHooks":true}');
  assert.ok(command.args.includes('--strict-mcp-config'));
  assert.equal(command.args[command.args.indexOf('--mcp-config')+1], '{"mcpServers":{}}');
  // Codex uses its reviewed native configuration; the adapter adds no policy
  // bypass or unverified isolation flag. The sandbox constrains filesystems only.
  const codex = buildNativeCommand({...base, type:'codex-worker'}, 'worker', {prompt:'test'});
  assert.deepEqual(codex.args, ['--ask-for-approval', 'never', 'exec', '--sandbox', 'read-only',
    '--json', '--model', base.model, '--cd', base.cwd, '--ephemeral', '-']);
});

test('environment does not import provider keys, model overrides or Node preload hooks', () => {
  const vars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'COPILOT_MODEL', 'NODE_OPTIONS', 'CLAUDE_CODE_MESSAGING_TOKEN'];
  const previous = vars.map(name => process.env[name]);
  try {
    for (const name of vars) process.env[name] = 'synthetic-sensitive-value';
    const {options} = buildNativeCommand({...base, type:'codex-worker'}, 'worker', {prompt:'test'});
    for (const name of vars) assert.equal(options.env[name], undefined);
  } finally {
    vars.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

test('queue accepts only an exact UUID receipt with clean close and no warnings', async () => {
  for (const [stdout, stderr, code, expected] of [
    [receipt, '', 0, 'queued'], ['', '', 0, 'uncertain'], [receipt, 'warning: failed resume', 0, 'uncertain'],
    [receipt, 'unrecognized warning', 0, 'uncertain'], [receipt, '', 1, 'uncertain'],
    [receipt.replace(ID, OTHER), '', 0, 'uncertain'], [`prefix\n${receipt}`, '', 0, 'uncertain'],
    [receipt+receipt, '', 0, 'uncertain'], [receipt.replace(OTHER, '-'.repeat(36)), '', 0, 'uncertain'],
    [receipt.toLowerCase(), '', 0, 'uncertain'],
  ]) {
    const {spawnProcess, calls} = fake({stdout, stderr, code});
    const result = await notifyNative(queue, {recipient:'test-inbox', spawnProcess});
    assert.equal(result.status, expected); assert.equal(result.exited, true);
    assert.equal(result.target_receipt, null); assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], 'queue'); assert.equal(calls[0].args.includes('--resume'), false);
    assert.equal(calls[0].args.includes('--model'), false);
    if (expected === 'queued') assert.deepEqual(result.queue_receipt, {message_id:OTHER, native_session_id:ID});
    if (stderr) assert.deepEqual(result.warnings, [stderr]);
  }
});

test('notification target, resume and command controls cannot come from request input', () => {
  const input = {recipient:'test-inbox', native_session_id:OTHER, resume:true, args:['--resume'], executable:'bad'};
  const command = buildNativeCommand(queue, 'notify', input);
  assert.equal(command.args[command.args.indexOf('--thread')+1], ID);
  assert.equal(command.args.includes('--resume'), false);
  assert.equal(command.executable, base.executable);
  assert.ok(buildNativeCommand({...queue, resume:true}, 'notify', input).args.includes('--resume'));
  for (const config of [{...queue, native_session_id:'last'}, {...queue, native_session_id:ID+'\n'}, {...queue, resume:'true'}]) {
    assert.equal(buildNativeCommand(config, 'notify', input).status, 'unsupported');
  }
  assert.equal(buildNativeCommand(queue, 'notify', {recipient:'x; injected'}).status, 'unsupported');
});

test('Claude notification requires verified stable binding and separates worker completion from receipt', async () => {
  for (const config of [{...claude, verified:false}, {...claude, target:{name:'PA'}}, {...claude, persist:true},
    {...claude, cwd:undefined}, {...claude, model:undefined}, {...claude, permissions:undefined}]) {
    const result = await notifyNative(config, {recipient:'test-inbox', spawnProcess:() => assert.fail('must not spawn')});
    assert.equal(result.status, 'unsupported');
  }
  const {spawnProcess, calls} = fake({stdout:claudeJson({result:`Sent to target ${OTHER}: completed`})});
  const result = await notifyNative(claude, {recipient:'test-inbox', spawnProcess});
  assert.equal(result.status, 'uncertain'); assert.equal(result.target_receipt, null);
  assert.equal(result.worker_result.status, 'completed');
  assert.equal(result.worker_result.native_session_id, ID);
  assert.equal(result.worker_result.persisted, false);
  const {args, input} = calls[0];
  assert.equal(args[args.indexOf('--tools')+1], 'Read,ListAgents,SendMessage');
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(input.includes(ID)); assert.ok(input.includes('test-host'));
  assert.equal(args.includes('--resume'), false);
});

test('workers parse actual native JSON identities and completion, never prose or requested IDs', async () => {
  for (const [type, stdout, status, id] of [
    ['codex-worker', codexJson(), 'completed', ID],
    ['claude-worker', claudeJson(), 'completed', ID],
    ['claude-worker', JSON.stringify(JSON.parse(claudeJson()), null, 2), 'completed', ID],
    ['claude-worker', claudeJson({subtype:'error_max_turns', is_error:true}), 'failed', ID],
    ['codex-worker', codexJson()+JSON.stringify({type:'turn.failed', error:{message:'denied'}}), 'failed', ID],
    ['codex-worker', `I created session ${ID}`, 'uncertain', undefined],
    ['claude-worker', claudeJson({session_id:'not-a-uuid'}), 'uncertain', undefined],
    ['codex-worker', codexJson(ID)+codexJson(OTHER), 'uncertain', undefined],
    ['codex-worker', JSON.stringify({type:'item.completed', item:{text:ID}}), 'uncertain', undefined],
    ['codex-worker', JSON.stringify({type:'thread.started', thread_id:ID}), 'uncertain', ID],
    ['claude-worker', 'null', 'uncertain', undefined],
    ['claude-worker', claudeJson({is_error:undefined}), 'uncertain', ID],
  ]) {
    const {spawnProcess} = fake({stdout});
    const result = await runNativeWorker({...base, type, native_session_id:OTHER}, {prompt:'test', spawnProcess});
    assert.equal(result.status, status, stdout); assert.equal(result.native_session_id, id);
    assert.equal(result.exited, true); assert.equal(result.persisted, false);
  }
});

test('Copilot is experimental, requires explicit persisted history, and makes no invented schema guarantee', async () => {
  const config = {...base, type:'copilot-worker'};
  for (const settings of [{}, {experimental:true}, {persist:true}, {experimental:'true', persist:true}]) {
    assert.equal(buildNativeCommand({...config, ...settings}, 'worker', {prompt:'test'}).status, 'unsupported');
  }
  const {spawnProcess, calls} = fake({stdout:JSON.stringify({type:'invented', session_id:ID})});
  const result = await runNativeWorker({...config, experimental:true, persist:true}, {prompt:'test', spawnProcess});
  assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'copilot_result_schema_unverified');
  assert.equal(result.persisted, true); assert.equal(result.native_session_id, undefined);
  assert.equal(result.cleanup_supported, false);
  for (const flag of ['--no-ask-user', '--no-auto-update', '--sync-session=off', '--available-tools=read']) assert.ok(calls[0].args.includes(flag));
});

test('exit without close never confirms exit or completion; no kill after observed exit', async () => {
  const {spawnProcess, calls} = fake({stdout:codexJson(), close:false});
  const result = await runNativeWorker({...base, type:'codex-worker', timeout_ms:5}, {prompt:'test', spawnProcess});
  assert.equal(result.status, 'uncertain'); assert.equal(result.exited, false);
  assert.equal(result.reason, 'timeout'); assert.deepEqual(calls[0].kills, []);
});

test('close drains output arriving after exit and is required for success', async () => {
  const {spawnProcess} = fake({run:child => {
    child.emit('exit', 0);
    child.stdout.emit('data', codexJson());
    child.emit('close', 0);
  }});
  const result = await runNativeWorker({...base, type:'codex-worker'}, {prompt:'test', spawnProcess});
  assert.equal(result.status, 'completed'); assert.equal(result.exited, true);
});

test('deadline kills only the owned child and stays uncertain even if termination closes it', async () => {
  for (const closes of [false, true]) {
    const {spawnProcess, calls} = fake({run:() => {}, onKill:(child, signal) => {
      if (closes) { child.emit('exit', null, signal); child.emit('close', null, signal); }
    }});
    const result = await runNativeWorker({...base, type:'codex-worker', timeout_ms:5}, {prompt:'test', spawnProcess});
    assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'timeout');
    assert.equal(result.exited, closes);
    assert.deepEqual(calls[0].kills, closes ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
  }
});

test('pre-abort never spawns; abort during execution terminates once and cleans its listener', async () => {
  const controller = new AbortController(); controller.abort();
  const before = await runNativeWorker({...base, type:'codex-worker'}, {
    prompt:'test', signal:controller.signal, spawnProcess:() => assert.fail('must not spawn')});
  assert.equal(before.exited, false); assert.equal(before.reason, 'aborted_before_spawn');
  const active = new AbortController();
  const {spawnProcess, calls} = fake({run:() => active.abort(), onKill:child => child.emit('close', null, 'SIGTERM')});
  const result = await runNativeWorker({...base, type:'codex-worker'}, {prompt:'test', signal:active.signal, spawnProcess});
  assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'aborted');
  assert.equal(result.exited, true); assert.deepEqual(calls[0].kills, ['SIGTERM']);
});

test('output has a shared byte cap, truncation indication and no partial UTF-8 expansion', async () => {
  const {spawnProcess} = fake({run:child => {
    child.stdout.emit('data', Buffer.from('🙂🙂'));
    child.stderr.emit('data', 'too much');
    child.emit('close', 0);
  }});
  const result = await runNativeWorker({...base, type:'codex-worker', max_output_bytes:7}, {prompt:'test', spawnProcess});
  assert.equal(result.status, 'uncertain'); assert.equal(result.truncated, true);
  assert.equal(result.reason, 'output_limit'); assert.equal(result.output, '🙂');
  assert.ok(Buffer.byteLength(result.output)+Buffer.byteLength(result.stderr) <= 7);
  const malformed = fake({run:child => {
    child.stdout.emit('data', Buffer.from([255, 255, 255, 255])); child.emit('close', 0);
  }});
  const invalid = await runNativeWorker({...base, type:'codex-worker', max_output_bytes:4}, {prompt:'test', spawnProcess:malformed.spawnProcess});
  assert.equal(invalid.truncated, true);
  assert.ok(Buffer.byteLength(invalid.output) <= 4);
});

test('spawn errors, process errors, stdin errors and signal exits remain bounded and uncertain', async () => {
  const cases = [
    () => { throw new Error('synthetic spawn failure'); },
    fake({run:child => child.emit('error', new Error('synthetic process failure'))}).spawnProcess,
    fake({run:child => child.stdin.emit('error', new Error('synthetic pipe failure'))}).spawnProcess,
    fake({stdout:codexJson(), code:null, signal:'SIGTERM'}).spawnProcess,
    fake({stdout:codexJson(), code:null}).spawnProcess,
  ];
  for (const spawnProcess of cases) {
    const result = await runNativeWorker({...base, type:'codex-worker'}, {prompt:'test', spawnProcess});
    assert.equal(result.status, 'uncertain');
  }
});

test('cleanup is native Codex only, explicit per action, exact UUID, and persistence opt-in', async () => {
  const config = {...base, type:'codex-worker', persist:true, cleanup:{archive:true, delete:true}};
  for (const type of ['claude-worker', 'copilot-worker', 'codex-queue']) {
    assert.equal((await cleanupNativeWorker({...config, type}, {native_session_id:ID, action:'delete',
      spawnProcess:() => assert.fail('must not spawn')})).status, 'unsupported');
  }
  for (const [settings, action, id] of [[{persist:false}, 'delete', ID], [{cleanup:{}}, 'delete', ID],
    [{}, 'purge', ID], [{}, 'delete', 'last'], [{}, 'archive', '../history'], [{}, 'delete', ID+';anything']]) {
    assert.equal(buildNativeCommand({...config, ...settings}, 'cleanup', {action, native_session_id:id}).status, 'unsupported');
  }
  for (const action of ['archive', 'delete']) {
    const {spawnProcess, calls} = fake();
    const result = await cleanupNativeWorker(config, {native_session_id:ID, action, spawnProcess});
    assert.equal(result.status, 'completed'); assert.equal(result.exited, true);
    assert.deepEqual(calls[0].args, [action, ID, ...(action === 'delete' ? ['--force'] : [])]);
  }
  const warning = fake({stderr:'warning: cleanup incomplete'});
  assert.equal((await cleanupNativeWorker(config, {native_session_id:ID, action:'delete', spawnProcess:warning.spawnProcess})).status, 'uncertain');
});
