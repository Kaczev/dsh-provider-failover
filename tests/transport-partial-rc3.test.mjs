import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PiAiAdapter } from '../.runtime/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/rc3-original.mjs';
import { streamSimple } from '../.runtime/node_modules/@earendil-works/pi-ai/dist/compat.js';
import { installTransport } from '../plugin/transport.js';

test('rc3 partial SSE EOF preserves failure and switches only on a fresh host attempt', async () => {
 const servers = [], hits = [];
 let restore;
 const listen = async (label, partial) => {
  const server = http.createServer(async (req, res) => {
   let raw = ''; for await (const part of req) raw += part;
   hits.push({ label, body: JSON.parse(raw), key: req.headers.authorization, path: req.url });
   res.writeHead(200, { 'content-type': 'text/event-stream' });
   res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: partial ? 'incomplete' : 'replacement' }, finish_reason: null }] }) + '\n\n');
   if (partial) res.end();
   else res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return `http://127.0.0.1:${server.address().port}/v1`;
 };
 try {
  const primary = await listen('primary', true), backup = await listen('backup', false);
  const model = Object.freeze({ id: 'fixture', name: 'fixture', api: 'openai-completions', provider: 'p', baseUrl: primary, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 });
  const adapter = new PiAiAdapter({ resolveApiKey: async () => 'synthetic-key' });
  adapter.current = () => ({ models: { streamSimple } });
  adapter.profileOf = () => ({ apiKeyEnv: 'FIXTURE', streamIdleTimeoutMs: 2000, headers: {}, configuredMaxTokens: new Map() });
  adapter.modelOf = () => model;
  const options = { provider: 'p', model: 'fixture', sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }], toolHistory: [], signal: new AbortController().signal };
  const run = async () => { const chunks = []; for await (const chunk of adapter.stream(options)) chunks.push(chunk); return chunks; };
  const baseline = await run();
  assert.ok(baseline.some(chunk => chunk.type === 'text-delta'));
  assert.equal(baseline.at(-1).reason.kind, 'error');
  assert.equal(baseline.at(-1).reason.failure.code, 'TRANSPORT');
  hits.length = 0;
  restore = installTransport(PiAiAdapter, () => ({ p: { enabled: true, backups: [backup] } }), new Map([['s', { routes: new Map() }]]));
  const failed = await run();
  assert.deepEqual(failed.at(-1).reason, baseline.at(-1).reason);
  assert.deepEqual(hits.map(hit => hit.label), ['primary']);
  const recovered = await run();
  assert.equal(recovered.at(-1).reason.kind, 'stop');
  assert.equal(recovered.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'replacement');
  assert.deepEqual(hits.map(hit => hit.label), ['primary', 'backup']);
  assert.deepEqual(hits[0].body, hits[1].body);
  assert.ok(hits.every(hit => hit.key === 'Bearer synthetic-key' && hit.path === '/v1/chat/completions'));
 } finally {
  restore?.();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
 }
});
