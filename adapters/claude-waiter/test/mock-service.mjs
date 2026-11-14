// Mock coordination service: only the adapter-only wake.wait tool, per the phase-2 contract
// (Codex PA, 13 Nov 2026). Synthetic data, loopback, bearer auth. For waiter tests only.
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function startMock({ token = 'synthetic-token', recipient = 'claude-pa', port = 0 } = {}) {
  const state = { pending: 0, paused: false, wrongRecipient: false, instantTimeout: false, calls: 0, instance_id: 'mock-1' };

  const makeServer = () => {
    const s = new Server({ name: 'mock-coordination', version: '0.0.0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
      name: 'wake.wait', description: 'adapter-only bounded wait',
      inputSchema: { type: 'object', properties: { recipient: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 0, maximum: 25000 } },
        required: ['recipient', 'timeout_ms'] } }] }));
    s.setRequestHandler(CallToolRequestSchema, async (req) => {
      state.calls++;
      const { recipient: r, timeout_ms } = req.params.arguments ?? {};
      if (req.params.name !== 'wake.wait') return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
      if (r !== recipient) return { isError: true, content: [{ type: 'text', text: 'forbidden: token scope does not match recipient' }] };
      const deadline = Date.now() + Math.min(Number(timeout_ms) || 0, 25000);
      for (;;) {   // durable state read before and during the bounded wait
        const status = state.paused ? 'paused' : state.pending > 0 ? 'pending' : null;
        if (status || state.instantTimeout || Date.now() >= deadline) {
          const sc = { status: status ?? 'timeout', recipient: state.wrongRecipient ? 'someone-else' : r,
            pending_count: state.pending, observed_at: new Date().toISOString(), instance_id: state.instance_id };
          return { structuredContent: sc, content: [{ type: 'text', text: JSON.stringify(sc) }] };
        }
        await new Promise((res) => setTimeout(res, 25));
      }
    });
    return s;
  };

  const httpServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('unauthorized'); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    let body = '';
    for await (const c of req) body += c;
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });   // stateless
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  });

  return new Promise((resolve) => httpServer.listen(port, '127.0.0.1', () => {
    const p = httpServer.address().port;
    resolve({ state, port: p, url: `http://127.0.0.1:${p}/mcp`,
      close: () => new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(() => r()); }) });
  }));
}
