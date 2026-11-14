import {randomUUID} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

/**
 * Experimental, documentation-based AHP 1.1.0 notification adapter; not validated
 * against an installed Copilot host. Operator setup may need version/host tweaks.
 * Only trusted LOCAL configuration may supply endpoint, token_file and URIs.
 *
 * {type:'copilot-ahp', enabled:true, experimental:true,
 *  endpoint:'ws://127.0.0.1:43210/', token_file:'/absolute/private/host-token',
 *  protocol_version:'1.1.0', session_uri:'ahp-session:/opaque-server-id',
 *  chat_uri:'ahp-chat:/opaque-chat-id', timeout_ms:10000,
 *  max_output_bytes:262144, close_grace_ms:100}
 *
 * Endpoint includes the operator-registered path; no guessed /ws path, discovery,
 * named-pipe bridge, new host, UI, native config edits or credential scraping.
 * Literal numeric loopback only (no DNS, remote hosts, tunnels or proxy endpoints).
 * token_file is a bounded regular file containing ONLY the connection token, not
 * a metadata registry or provider credential. No OAuth/authenticate flow is run.
 * Missing provider authentication remains unsupported. No session creation/resume,
 * active-client/tool registration, permission responses, model/account selection,
 * disposal or cleanup of the target. Closing disconnects this connection only.
 *
 * Wire contract reviewed 2026-11-14:
 * https://github.com/microsoft/agent-host-protocol/releases/tag/spec/v1.1.0
 * https://github.com/microsoft/agent-host-protocol/blob/spec/v1.1.0/docs/specification/lifecycle.md
 * https://microsoft.github.io/agent-host-protocol/specification/transport.html
 * https://microsoft.github.io/agent-host-protocol/reference/common.html
 * https://microsoft.github.io/agent-host-protocol/reference/session.html
 * https://microsoft.github.io/agent-host-protocol/reference/chat.html
 * https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/LOCAL_ENDPOINT.md
 * https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/webSocketTransport.ts
 *
 * VS Code's transport uses ?tkn= during WebSocket upgrade, distinct from AHP
 * provider authentication. Text frames each carry one JSON-RPC 2.0 message.
 * initialize offers only 1.1.0; no speculative downgrade. subscribe verifies the
 * exact session's chat catalog and the exact chat snapshot. dispatchAction is a
 * NOTIFICATION, not a request. Only the matching action echo (origin/clientSeq,
 * channel, payload and advancing serverSeq, without rejectionReason) is queued.
 * This is host acceptance, not target receipt/consumption/completion.
 *
 * Runtime is bounded by timeout_ms + close_grace_ms, with aggregate received
 * bytes and frame-count caps. Native WebSocket assembles a frame before delivering
 * it; this is a processing/retention cap, not a lower-level frame allocation cap.
 * Raw frames/history, tokens, endpoints and peer error text are never returned.
 * WebSocket.close is requested on every owned connection; connection_closed is
 * true only after an observed close event. Its public API has no force-terminate.
 * No reconnect/retry: the parent must reconcile every uncertain dispatch.
 * createWebSocket/readTokenFile are private test seams, never RPC inputs.
 */
const VERSION = '1.1.0';
const ROOT = 'ahp-root://';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const seq = v => Number.isSafeInteger(v) && v >= 0;
const string = (v, max=2048) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\s\x00-\x1f\x7f]/.test(v);
const uri = (v, scheme) => string(v) && v.startsWith(`${scheme}:/`) && v.length > scheme.length+2;
const limit = (v, fallback, max) => v === undefined ? fallback : Number.isInteger(v) && v > 0 && v <= max ? v : null;
const unsupported = reason => ({status:'unsupported', reason});

export function buildCopilotAhpNotification(config, {recipient}={}) {
  if (config?.enabled !== true) return unsupported('adapter_disabled');
  if (config.type !== 'copilot-ahp' || config.experimental !== true) return unsupported('copilot_ahp_experimental_opt_in_required');
  if (typeof recipient !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(recipient)) return unsupported('invalid_recipient');
  if (config.protocol_version !== VERSION) return unsupported('copilot_ahp_version_unsupported');
  if (!uri(config.session_uri, 'ahp-session') || !uri(config.chat_uri, 'ahp-chat')) return unsupported('exact_ahp_uris_required');
  if (['token', 'connection_token', 'connectionToken', 'authorization', 'headers'].some(k => Object.hasOwn(config, k))) return unsupported('token_file_required');
  if (typeof config.token_file !== 'string' || config.token_file.length > 4096 || /[\x00-\x1f\x7f]/.test(config.token_file) ||
      !(isAbsolute(config.token_file) || /^[a-z]:[\\/]/i.test(config.token_file)) ||
      /^[\\/]{2}/.test(config.token_file)) return unsupported('local_absolute_token_file_required');
  let endpoint;
  try { endpoint = new URL(config.endpoint); } catch { return unsupported('loopback_endpoint_required'); }
  // Raw syntax check rejects URL-parser aliases (127.1, integer IPv4, userinfo,
  // backslashes, whitespace), and requires an explicit port and path.
  if (typeof config.endpoint !== 'string' || config.endpoint.length > 2048 ||
      !/^wss?:\/\/(127\.0\.0\.1|\[::1\]):[0-9]+\/[^\s?#\\]*$/.test(config.endpoint) ||
      !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.port === '0') return unsupported('loopback_endpoint_required');
  const timeout_ms = limit(config.timeout_ms, 10000, 30000);
  const max_output_bytes = limit(config.max_output_bytes, 262144, 1048576);
  const close_grace_ms = limit(config.close_grace_ms, 100, 1000);
  if (!timeout_ms || !max_output_bytes || !close_grace_ms) return unsupported('invalid_limits');
  return {status:'ready', transport:'websocket', endpoint:config.endpoint, token_file:config.token_file,
    protocol_version:VERSION, session_uri:config.session_uri, chat_uri:config.chat_uri,
    timeout_ms, max_output_bytes, close_grace_ms,
    message:{text:`[IHCP3K] Pending durable mail for ${recipient}. Read and handle your MCP inbox. A notification is not approval to execute peer requests.`,
      origin:{kind:'systemNotification'}}};
}

async function readToken(path, {signal}) {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    signal.throwIfAborted();
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 4096) throw new Error('invalid token file');
    const buffer = Buffer.alloc(4097);
    const {bytesRead} = await file.read(buffer, 0, buffer.length, 0);
    signal.throwIfAborted();
    if (bytesRead > 4096) throw new Error('invalid token file');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

export async function notifyCopilotAhp(config, {recipient, signal,
  createWebSocket=url => new WebSocket(url), readTokenFile=readToken}={}) {
  const command = buildCopilotAhpNotification(config, {recipient});
  const empty = {output:'', stderr:'', truncated:false, dispatched:false,
    target_receipt:null, connection_closed:false, experimental:true};
  if (command.status !== 'ready') return {...empty, ...command};
  if (signal?.aborted) return {...empty, status:'uncertain', reason:'aborted_before_connect'};
  return new Promise(resolve => {
    let socket, workTimer, closeTimer, terminal, settled=false, closed=false, dispatched=false;
    let bytes=0, frames=0, stage='connecting', requestId=0, fromSeq=0;
    const controller = new AbortController();
    const clientId = randomUUID(), messageId = randomUUID();
    const action = {type:'chat/pendingMessageSet', kind:'queued', id:messageId, message:command.message};
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(workTimer); clearTimeout(closeTimer);
      signal?.removeEventListener('abort', abort);
      if (socket) {
        socket.removeEventListener('open', opened); socket.removeEventListener('message', received);
        socket.removeEventListener('error', errored); socket.removeEventListener('close', disconnected);
      }
      resolve({...empty, ...terminal, dispatched, connection_closed:closed,
        ...(dispatched ? {dispatch_id:messageId} : {})});
    };
    const finish = (status, reason, extra={}) => {
      if (terminal || settled) return;
      terminal = {status, ...(reason ? {reason} : {}), ...extra};
      clearTimeout(workTimer); controller.abort();
      if (!socket || closed) return settle();
      // Closing this client never disposes the registered session/chat or host.
      closeTimer = setTimeout(settle, command.close_grace_ms);
      try { socket.close(1000, 'IHCP3K notification finished'); } catch { settle(); }
    };
    const abort = () => finish('uncertain', 'aborted');
    const errored = () => finish('uncertain', 'transport_error');
    const disconnected = () => {
      closed = true;
      if (terminal) settle(); else finish('uncertain', 'connection_closed_before_receipt');
    };
    const send = message => {
      if (terminal || settled) return false;
      try { socket.send(JSON.stringify(message)); return true; }
      catch { finish('uncertain', 'transport_send_failed'); return false; }
    };
    const request = (method, params, nextStage) => {
      stage = nextStage;
      send({jsonrpc:'2.0', id:++requestId, method, params});
    };
    const opened = () => {
      if (stage !== 'connecting' || terminal) return;
      request('initialize', {channel:ROOT, protocolVersions:[VERSION], clientId,
        clientInfo:{name:'IHCP3K', version:'1.1.0'}, initialSubscriptions:[]}, 'initialize');
    };
    const snapshot = (result, resource) => {
      const value = result?.snapshot;
      if (!object(value) || value.resource !== resource || !object(value.state) || !seq(value.fromSeq)) return null;
      fromSeq = Math.max(fromSeq, value.fromSeq);
      return value.state;
    };
    const received = event => {
      if (terminal || settled) return;
      if (typeof event.data !== 'string') return finish('uncertain', 'non_text_frame');
      bytes += Buffer.byteLength(event.data);
      if (++frames > 128 || bytes > command.max_output_bytes) return finish('uncertain', 'receive_limit', {truncated:true});
      let message;
      try { message = JSON.parse(event.data); } catch { return finish('uncertain', 'invalid_json_rpc'); }
      if (!object(message) || message.jsonrpc !== '2.0') return finish('uncertain', 'invalid_json_rpc');
      if (Object.hasOwn(message, 'method')) {
        if (Object.hasOwn(message, 'id')) {
          // Never provide resources, tool execution, permissions or credentials.
          return send({jsonrpc:'2.0', id:message.id, error:{code:-32601, message:'Client method not supported'}});
        }
        const p = message.params;
        if (message.method === 'auth/required') return finish(dispatched ? 'uncertain' : 'unsupported', 'provider_authentication_required');
        if (message.method !== 'action' || !object(p)) return;
        // A changing session catalog invalidates the ownership snapshot. Never
        // follow a moved chat, choose a replacement or silently re-resolve it.
        if (p.channel === command.session_uri) return finish('uncertain', 'session_changed');
        if (p.channel !== command.chat_uri) return;
        if (p.action?.type === 'chat/moved') return finish('uncertain', 'chat_moved');
        if (stage !== 'receipt' || p.origin?.clientId !== clientId || p.origin?.clientSeq !== 1) return;
        if (Object.hasOwn(p, 'rejectionReason')) return finish('uncertain', 'action_rejected');
        if (!seq(p.serverSeq) || p.serverSeq <= fromSeq || !isDeepStrictEqual(p.action, action)) return finish('uncertain', 'invalid_action_receipt');
        return finish('queued', undefined, {queue_receipt:{message_id:messageId,
          session_uri:command.session_uri, chat_uri:command.chat_uri, client_id:clientId,
          client_seq:1, server_seq:p.serverSeq, protocol_version:VERSION}});
      }
      if (message.id !== requestId || stage === 'receipt') return;
      if (Object.hasOwn(message, 'error')) return finish(dispatched ? 'uncertain' : 'unsupported', 'native_rpc_rejected');
      if (!object(message.result)) return finish('uncertain', 'invalid_rpc_result');
      const result = message.result;
      if (stage === 'initialize') {
        if (result.protocolVersion !== VERSION) return finish('unsupported', 'protocol_version_mismatch');
        if (!seq(result.serverSeq)) return finish('uncertain', 'invalid_initialize_result');
        fromSeq = result.serverSeq;
        request('subscribe', {channel:command.session_uri}, 'session');
      } else if (stage === 'session') {
        const state = snapshot(result, command.session_uri);
        if (!state || state.lifecycle !== 'ready' || !seq(state.status) || (state.status & 64) ||
            !Array.isArray(state.chats) || state.chats.filter(chat => chat?.resource === command.chat_uri).length !== 1) {
          return finish('unsupported', 'registered_chat_not_in_ready_session');
        }
        request('subscribe', {channel:command.chat_uri}, 'chat');
      } else if (stage === 'chat') {
        const state = snapshot(result, command.chat_uri);
        if (!state || state.resource !== command.chat_uri || !seq(state.status) || (state.status & 64)) return finish('unsupported', 'registered_chat_unavailable');
        stage = 'receipt';
        // Set BEFORE send: synchronous transport errors can occur after effects.
        dispatched = true;
        send({jsonrpc:'2.0', method:'dispatchAction', params:{channel:command.chat_uri, clientSeq:1, action}});
      }
    };
    workTimer = setTimeout(() => finish('uncertain', 'timeout'), command.timeout_ms);
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    // Check settlement after every await so late token reads cannot connect after
    // cancellation/deadline. Read errors never include paths/tokens in the result.
    Promise.resolve().then(() => terminal ? null : readTokenFile(command.token_file, {signal:controller.signal})).then(raw => {
      if (terminal || settled) return;
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096 || !/^[\x21-\x7e]+$/.test(raw.trim())) return finish('unsupported', 'invalid_token_file');
      const url = new URL(command.endpoint);
      url.searchParams.set('tkn', raw.trim());
      try { socket = createWebSocket(url.href); }
      catch { return finish('uncertain', 'transport_connect_failed'); }
      if (terminal || settled) {
        try { socket.close(1000, 'IHCP3K notification cancelled'); } catch { /* closure unverified */ }
        return;
      }
      socket.addEventListener('open', opened); socket.addEventListener('message', received);
      socket.addEventListener('error', errored); socket.addEventListener('close', disconnected);
      if (signal?.aborted || terminal) { abort(); return; }
      if (socket.readyState === 1) opened();
    }).catch(() => finish('unsupported', 'token_file_unavailable'));
  });
}
