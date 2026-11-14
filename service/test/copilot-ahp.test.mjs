import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {buildCopilotAhpNotification, notifyCopilotAhp} from '../src/copilot-ahp.mjs';
import {buildNativeCommand, notifyNative} from '../src/native-adapters.mjs';

const config = {type:'copilot-ahp', enabled:true, experimental:true,
  endpoint:'ws://127.0.0.1:43210/registered-path', token_file:'E:/synthetic/private/host.token',
  protocol_version:'1.1.0', session_uri:'ahp-session:/synthetic-session', chat_uri:'ahp-chat:/opaque/chat',
  timeout_ms:100, close_grace_ms:2};
const token = 'synthetic-connection-token';
const recipient = 'test-inbox';
const event = (name, properties={}) => Object.assign(new Event(name), properties);

function transport({behavior, transform=v => v, chatStatus=1, closes=true, opens=true, create}={}) {
  const sockets=[], reads=[];
  const readTokenFile = async (path, options) => { reads.push({path, options}); return token+'\n'; };
  const createWebSocket = url => {
    class Socket extends EventTarget {
      readyState = 0;
      sent = [];
      closeCalls = 0;
      clientId;
      emit(message) { this.dispatchEvent(event('message', {data:typeof message === 'string' ? message : JSON.stringify(message)})); }
      send(data) {
        const message = JSON.parse(data); this.sent.push(message);
        const reply = result => queueMicrotask(() => this.emit(transform({jsonrpc:'2.0', id:message.id, result}, message)));
        if (behavior?.(message, this, reply)) return;
        if (message.method === 'initialize') {
          this.clientId = message.params.clientId;
          reply({protocolVersion:'1.1.0', serverSeq:5, snapshots:[]});
        } else if (message.method === 'subscribe') {
          const resource = message.params.channel;
          const state = resource === config.session_uri ?
            {lifecycle:'ready', provider:'copilot', status:chatStatus, chats:[{resource:config.chat_uri}]} :
            {resource:config.chat_uri, status:chatStatus, turns:[]};
          reply({snapshot:{resource, state, fromSeq:7}});
        } else if (message.method === 'dispatchAction') {
          queueMicrotask(() => this.emit(transform({jsonrpc:'2.0', method:'action', params:{
            channel:message.params.channel, action:message.params.action, serverSeq:8,
            origin:{clientId:this.clientId, clientSeq:message.params.clientSeq}}}, message)));
        }
      }
      close() {
        this.closeCalls++;
        this.readyState = 2;
        if (closes) queueMicrotask(() => { this.readyState=3; this.dispatchEvent(event('close')); });
      }
    }
    const socket = new Socket(); socket.url=url; sockets.push(socket);
    create?.(socket);
    if (opens) queueMicrotask(() => { socket.readyState=1; socket.dispatchEvent(event('open')); });
    return socket;
  };
  return {sockets, reads, createWebSocket, readTokenFile};
}

test('pure preflight accepts only explicit local experimental AHP 1.1.0 configuration', () => {
  assert.equal(buildCopilotAhpNotification(config, {recipient}).status, 'ready');
  assert.equal(buildNativeCommand(config, 'notify', {recipient}).transport, 'websocket');
  assert.equal(buildNativeCommand(config, 'worker', {prompt:'test'}).status, 'unsupported');
  assert.equal(buildNativeCommand(config, 'cleanup', {}).status, 'unsupported');
  const changes = [{enabled:false}, {experimental:undefined}, {experimental:'true'},
    {protocol_version:undefined}, {protocol_version:'0.9.0'}, {protocol_version:'1.2.0'},
    {session_uri:'session-name'}, {chat_uri:'chat-title'}, {chat_uri:'ahp-chat:/'},
    {token_file:undefined}, {token_file:'relative.token'}, {token_file:'\\\\server\\share\\token'},
    {token:'literal-secret'}, {connectionToken:'literal-secret'}, {headers:{Authorization:'secret'}},
    {timeout_ms:30001}, {timeout_ms:0}, {max_output_bytes:1048577}, {close_grace_ms:0},
    ...['ws://example.com:1234/', 'ws://localhost:1234/', 'ws://127.1:1234/', 'ws://2130706433:1234/',
      'ws://127.0.0.1:0/', 'ws://127.0.0.1:0000/', 'ws://127.0.0.1/',
      'ws://user:secret@127.0.0.1:1234/', 'ws://127.0.0.1:1234/?tkn=secret',
      'ws://127.0.0.1:1234/#secret', 'file:///pipe', 'ws+unix:///pipe',
      'https://127.0.0.1:1234/', 'ws://127.0.0.1:1234\\evil'].map(endpoint => ({endpoint}))];
  for (const change of changes) assert.equal(buildCopilotAhpNotification({...config, ...change}, {recipient}).status, 'unsupported', JSON.stringify(change));
  for (const value of [undefined, '', ['test-inbox'], 'test; command', 'a'.repeat(65)]) {
    assert.equal(buildCopilotAhpNotification(config, {recipient:value}).status, 'unsupported');
  }
  assert.equal(buildCopilotAhpNotification({...config, endpoint:'wss://[::1]:43210/explicit'}, {recipient}).status, 'ready');
});

test('native integration sends one attributed queued doorbell to the registered idle/busy chat', async () => {
  for (const chatStatus of [1, 8, 24]) {
    const mock = transport({chatStatus});
    const result = await notifyNative(config, {recipient, ...mock, spawnProcess:() => assert.fail('no host/worker spawn')});
    assert.equal(result.status, 'queued'); assert.equal(result.connection_closed, true);
    assert.equal(result.dispatched, true); assert.equal(result.target_receipt, null);
    assert.equal(result.queue_receipt.protocol_version, '1.1.0');
    const [socket] = mock.sockets;
    const url = new URL(socket.url);
    assert.equal(url.pathname, '/registered-path'); assert.equal(url.searchParams.get('tkn'), token);
    assert.equal(mock.reads[0].path, config.token_file);
    assert.deepEqual(socket.sent.map(m => m.method), ['initialize', 'subscribe', 'subscribe', 'dispatchAction']);
    assert.deepEqual(socket.sent[0].params.protocolVersions, ['1.1.0']);
    assert.equal(socket.sent[1].params.channel, config.session_uri);
    assert.equal(socket.sent[2].params.channel, config.chat_uri);
    const dispatch = socket.sent[3];
    assert.equal(dispatch.id, undefined); assert.equal(dispatch.params.clientSeq, 1);
    assert.equal(dispatch.params.action.kind, 'queued');
    assert.equal(dispatch.params.action.message.origin.kind, 'systemNotification');
    assert.ok(dispatch.params.action.message.text.includes(recipient));
    assert.equal(dispatch.params.action.message.model, undefined);
    assert.equal(result.queue_receipt.message_id, dispatch.params.action.id);
    assert.equal(socket.closeCalls, 1);
    for (const name of ['open', 'message', 'error', 'close']) assert.equal(getEventListeners(socket, name).length, 0);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('request input cannot override trusted endpoint, token file, URI or message payload', async () => {
  const mock = transport();
  const result = await notifyNative(config, {recipient, ...mock, endpoint:'ws://evil:80/',
    token_file:'other', chat_uri:'ahp-chat:/other', message:'injected', protocol_version:'0.1.0'});
  assert.equal(result.status, 'queued');
  assert.equal(mock.reads[0].path, config.token_file);
  assert.ok(mock.sockets[0].url.startsWith(config.endpoint));
  assert.equal(mock.sockets[0].sent.at(-1).params.channel, config.chat_uri);
  assert.equal(mock.sockets[0].sent.at(-1).params.action.message.text.includes('injected'), false);
});

test('missing, ambiguous, archived or mismatched registered targets never dispatch', async () => {
  const alterations = [
    (r, m) => { if (m.method==='initialize') r.result.protocolVersion='0.9.0'; },
    (r, m) => { if (m.params.channel===config.session_uri) r.result.snapshot.resource='ahp-session:/other'; },
    (r, m) => { if (m.params.channel===config.session_uri) r.result.snapshot.state.chats=[]; },
    (r, m) => { if (m.params.channel===config.session_uri) r.result.snapshot.state.chats.push({resource:config.chat_uri}); },
    (r, m) => { if (m.params.channel===config.session_uri) r.result.snapshot.state.lifecycle='creating'; },
    (r, m) => { if (m.params.channel===config.session_uri) r.result.snapshot.state.status=65; },
    (r, m) => { if (m.params.channel===config.chat_uri) r.result.snapshot.state.resource='ahp-chat:/other'; },
    (r, m) => { if (m.params.channel===config.chat_uri) r.result.snapshot.state.status=65; },
    (r, m) => { if (m.params.channel===config.chat_uri) delete r.result.snapshot; },
  ];
  for (const alter of alterations) {
    const mock = transport({transform:(r,m) => { alter(r,m); return r; }});
    const result = await notifyCopilotAhp(config, {recipient, ...mock});
    assert.equal(result.status, 'unsupported'); assert.equal(result.dispatched, false);
    assert.equal(mock.sockets[0].sent.some(m => m.method==='dispatchAction'), false);
  }
});

test('only a matching accepted action echo establishes queue acceptance', async () => {
  const alterations = [
    p => { p.rejectionReason=''; }, p => { p.serverSeq=7; }, p => { p.serverSeq='8'; },
    p => { p.origin.clientId='other-client'; }, p => { p.origin.clientSeq=2; },
    p => { p.channel='ahp-chat:/other'; }, p => { p.action.id='other-message'; },
    p => { p.action.kind='steering'; }, p => { p.action.message.text='different'; },
    p => { p.action.message.origin.kind='user'; },
  ];
  for (const alter of alterations) {
    const mock = transport({transform:(r,m) => { if (m.method==='dispatchAction') alter(r.params); return r; }});
    const result = await notifyCopilotAhp({...config, timeout_ms:8}, {recipient, ...mock});
    assert.equal(result.status, 'uncertain'); assert.equal(result.dispatched, true);
    assert.equal(result.queue_receipt, undefined);
    assert.equal(mock.sockets[0].sent.filter(m => m.method==='dispatchAction').length, 1);
  }
});

test('no receipt, lost connection and send-after-effect failure are uncertain without reconnect', async () => {
  for (const mode of ['silent', 'close', 'error', 'throw']) {
    const mock = transport({behavior:(m,s) => {
      if (m.method !== 'dispatchAction') return false;
      if (mode==='close') queueMicrotask(() => s.dispatchEvent(event('close')));
      if (mode==='error') queueMicrotask(() => s.dispatchEvent(event('error')));
      if (mode==='throw') throw new Error(`never leak ${token}`);
      return true;
    }});
    const result = await notifyCopilotAhp({...config, timeout_ms:8}, {recipient, ...mock});
    assert.equal(result.status, 'uncertain'); assert.equal(result.dispatched, true);
    assert.equal(mock.sockets.length, 1); assert.equal(result.queue_receipt, undefined);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('RPC denials and provider auth challenges never trigger authentication or fallback', async () => {
  for (const mode of ['rpc', 'auth']) {
    const mock = transport({behavior:(m,s) => {
      if (m.method!=='initialize') return false;
      queueMicrotask(() => s.emit(mode==='rpc' ?
        {jsonrpc:'2.0', id:m.id, error:{code:-32007, message:`sensitive ${token}`}} :
        {jsonrpc:'2.0', method:'auth/required', params:{channel:'ahp-root://', resource:'https://example.com'}}));
      return true;
    }});
    const result = await notifyCopilotAhp(config, {recipient, ...mock});
    assert.equal(result.status, 'unsupported'); assert.equal(result.dispatched, false);
    assert.deepEqual(mock.sockets[0].sent.map(m=>m.method), ['initialize']);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('reverse RPC requests receive no capabilities, files, permissions or token', async () => {
  const mock = transport({behavior:(m,s) => {
    if (m.method==='initialize') queueMicrotask(() => s.emit({jsonrpc:'2.0', id:'reverse', method:'resourceRead',
      params:{channel:'ahp-root://', uri:'file:///private/token'}}));
    return false;
  }});
  const result = await notifyCopilotAhp(config, {recipient, ...mock});
  assert.equal(result.status, 'queued');
  const denied = mock.sockets[0].sent.find(m => m.id==='reverse');
  assert.equal(denied.error.code, -32601); assert.equal(denied.result, undefined);
  assert.equal(JSON.stringify(mock.sockets[0].sent).includes(token), false);
});

test('malformed, binary and oversized frames are bounded and never preserved', async () => {
  for (const data of ['{broken', '[]', JSON.stringify({jsonrpc:'1.0'}), new Uint8Array([1]), 'x'.repeat(2000)]) {
    const mock = transport({behavior:(m,s) => {
      if (m.method==='initialize') queueMicrotask(() => s.dispatchEvent(event('message', {data})));
      return true;
    }});
    const result = await notifyCopilotAhp({...config, max_output_bytes:1000}, {recipient, ...mock});
    assert.equal(result.status, 'uncertain'); assert.equal(result.dispatched, false);
    assert.equal(result.output, ''); assert.equal(result.stderr, '');
    assert.equal(result.truncated, typeof data==='string' && data.length>1000);
  }
  const flood = transport({behavior:(m,s) => {
    if (m.method==='initialize') queueMicrotask(() => {
      for (let i=0; i<129; i++) s.emit({jsonrpc:'2.0', method:'irrelevant', params:{}});
    });
    return true;
  }});
  assert.equal((await notifyCopilotAhp(config, {recipient, ...flood})).reason, 'receive_limit');
});

test('token file failures and disabled config do not connect or leak error details', async () => {
  for (const readTokenFile of [async()=>{throw new Error(token);}, async()=>'', async()=>'two words', async()=>token.repeat(300)]) {
    const result = await notifyCopilotAhp(config, {recipient, readTokenFile,
      createWebSocket:()=>assert.fail('must not connect')});
    assert.equal(result.status, 'unsupported'); assert.equal(result.dispatched, false);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
  const result = await notifyNative({...config, enabled:false}, {recipient,
    readTokenFile:()=>assert.fail('must not read'), createWebSocket:()=>assert.fail('must not connect')});
  assert.equal(result.status, 'unsupported');
});

test('abort/deadline release listeners and late token reads cannot open a connection', async () => {
  const pre = new AbortController(); pre.abort();
  assert.equal((await notifyCopilotAhp(config, {recipient, signal:pre.signal,
    readTokenFile:()=>assert.fail('must not read')})).reason, 'aborted_before_connect');
  let resolveToken;
  const result = await notifyCopilotAhp({...config, timeout_ms:5}, {recipient,
    readTokenFile:()=>new Promise(resolve => {resolveToken=resolve;}), createWebSocket:()=>assert.fail('late connect')});
  assert.equal(result.reason, 'timeout'); resolveToken(token);
  await new Promise(resolve => setImmediate(resolve));
  for (const method of ['initialize', 'dispatchAction']) {
    const controller = new AbortController();
    const mock = transport({behavior:m => {
      if (m.method!==method) return false;
      controller.abort(); return true;
    }});
    const aborted = await notifyCopilotAhp(config, {recipient, signal:controller.signal, ...mock});
    assert.equal(aborted.reason, 'aborted');
    assert.equal(aborted.dispatched, method==='dispatchAction');
    assert.equal(mock.sockets[0].closeCalls, 1);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    for (const name of ['open', 'message', 'error', 'close']) assert.equal(getEventListeners(mock.sockets[0], name).length, 0);
  }
});

test('unconfirmed close stays explicit and removes adapter listeners; no shared host disposal', async () => {
  const mock = transport({closes:false});
  const result = await notifyCopilotAhp(config, {recipient, ...mock});
  assert.equal(result.status, 'queued'); assert.equal(result.connection_closed, false);
  assert.equal(mock.sockets[0].closeCalls, 1);
  for (const name of ['open', 'message', 'error', 'close']) assert.equal(getEventListeners(mock.sockets[0], name).length, 0);
  assert.equal(mock.sockets[0].sent.some(m=>/dispose|create|reconnect|authenticate/i.test(m.method)), false);
  const controller = new AbortController();
  const race = transport({create:() => controller.abort()});
  const aborted = await notifyCopilotAhp(config, {recipient, signal:controller.signal, ...race});
  assert.equal(aborted.reason, 'aborted');
  assert.equal(race.sockets[0].closeCalls, 1);
});

test('session/catalog change invalidates the selected binding instead of following another chat', async () => {
  const mock = transport({behavior:(m,s) => {
    if (m.method==='subscribe' && m.params.channel===config.chat_uri) {
      queueMicrotask(() => s.emit({jsonrpc:'2.0', method:'action', params:{channel:config.session_uri,
        action:{type:'session/chatRemoved', chat:config.chat_uri}, serverSeq:9}}));
      return true;
    }
    return false;
  }});
  const result = await notifyCopilotAhp(config, {recipient, ...mock});
  assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'session_changed');
  assert.equal(result.dispatched, false);
});
