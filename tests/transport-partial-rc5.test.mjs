import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PiAiAdapter } from '../.runtime/rc5/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
import { streamSimple } from '../.runtime/rc5/node_modules/@earendil-works/pi-ai/dist/compat.js';
import { installTransport } from '../plugin/transport.js';
import { Context } from '../.runtime/rc5/node_modules/@deepseek-ai/cordis/lib/index.js';
import { apply as applyRetry } from '../.runtime/rc5/node_modules/@deepseek-ai/dsh-llm-retry/lib/index.js';

for (const scenario of ['EOF', 'server_error']) test(`rc5 partial SSE ${scenario} switches only on a fresh host attempt`, async () => {
 const servers = [], hits = [];
 let restore;
 const listen = async (label, partial) => {
  const server = http.createServer(async (req, res) => {
   let raw = ''; for await (const part of req) raw += part;
   hits.push({ label, body: JSON.parse(raw), key: req.headers.authorization, path: req.url });
   res.writeHead(200, { 'content-type': 'text/event-stream' });
   res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: partial ? 'incomplete' : 'replacement' }, finish_reason: null }] }) + '\n\n');
   if (partial) res.end(scenario === 'server_error' ? 'data: ' + JSON.stringify({ error: { type: 'server_error', message: 'An error occurred while processing your request. Please try again later. (server_error)' } }) + '\n\n' : '');
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
  assert.equal(baseline.at(-1).reason.failure.code, scenario === 'EOF' ? 'TRANSPORT' : 'PI_AI_ERROR');
  hits.length = 0;
  restore = installTransport(PiAiAdapter, () => ({ p: { enabled: true, backups: [backup] } }), new Map([['s', { routes: new Map() }]]));
  const failed = await run();
  assert.deepEqual(failed.at(-1).reason, scenario === 'EOF' ? baseline.at(-1).reason : { ...baseline.at(-1).reason, failure: { ...baseline.at(-1).reason.failure, code: 'SERVER' } });
  assert.deepEqual(hits.map(hit => hit.label), ['primary']);
  const ctx = new Context(), events = [], state = {};
  ctx.provide('sessionProjections', { register() {}, stateOf: () => state });
  const agent = { session: { append(type, data) { events.push({ type, data }); if (type === 'llm/retry') state[JSON.stringify([data.provider, data.policyKey])] = { retry: data.retry, retryId: data.retryId }; } } };
  const payload = { agent, turn: 0, step: 0, provider: 'p', failure: failed.at(-1).reason.failure, signal: options.signal, retryPolicy: { mode: 'normal', maxRetries: 1, retryableCodes: ['TRANSPORT', 'SERVER'], initialDelayMs: 0, maxDelayMs: 1, jitterRatio: 0 } };
  try {
   applyRetry(ctx);
   assert.equal(await ctx.waterfall('agent/request-error', { ...payload, retryPolicy: undefined }, async () => undefined), undefined);
   assert.equal(await ctx.waterfall('agent/request-error', { ...payload, retryPolicy: { ...payload.retryPolicy, retryableCodes: ['OTHER'] } }, async () => undefined), undefined);
   assert.deepEqual(await ctx.waterfall('agent/request-error', payload, async () => undefined), { kind: 'retry' });
   assert.equal(await ctx.waterfall('agent/request-error', payload, async () => undefined), undefined, 'host retry budget is unchanged');
   assert.deepEqual(events.map(event => event.type), ['llm/retry', 'llm/retry-started']);
  } finally { await ctx.fiber.dispose(); }
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
