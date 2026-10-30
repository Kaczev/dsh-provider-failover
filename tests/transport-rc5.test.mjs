import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PiAiAdapter } from '../.runtime/rc5/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
import { streamSimple } from '../.runtime/rc5/node_modules/@earendil-works/pi-ai/dist/compat.js';
import { installTransport } from '../plugin/transport.js';

test('unmodified installed rc5 sends primary then backup and retains route only within turn', async () => {
 const servers = [], hits = [];
 const listen = async (label, status) => {
  const s = http.createServer(async (req, res) => {
   let raw = ''; for await (const part of req) raw += part;
   hits.push({ label, path: req.url, key: req.headers.authorization, body: JSON.parse(raw) });
   if (status) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":{"message":"fixture failure"}}'); }
   else { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'); }
  });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); servers.push(s);
  return `http://127.0.0.1:${s.address().port}/v1`;
 };
 let restore;
 try {
  const primary = await listen('primary', 502), backup = await listen('backup');
  const model = Object.freeze({ id:'fixture', name:'fixture', api:'openai-completions', provider:'p', baseUrl:primary, reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000 });
  const adapter = new PiAiAdapter({ resolveApiKey: async () => 'synthetic-key' });
  adapter.current = () => ({ models: { streamSimple } });
  adapter.profileOf = () => ({ apiKeyEnv:'FIXTURE', streamIdleTimeoutMs:2000, headers:{}, configuredMaxTokens:new Map() });
  adapter.modelOf = () => model;
  const turns = new Map([['s', { routes:new Map() }]]);
  // HTTP is isolated fixture transport only; production Config accepts HTTPS only.
  restore = installTransport(PiAiAdapter, () => ({p:{enabled:true,backups:[backup]}}), turns);
  const run = async () => { const chunks=[]; for await (const c of adapter.stream({provider:'p',model:'fixture',sessionId:'s',messages:[{role:'user',content:[{type:'text',text:'fixture'}]}],toolHistory:[],temperature:.3,maxTokens:32,signal:new AbortController().signal})) chunks.push(c); assert.equal(chunks.at(-1).reason.kind,'stop'); };
  await run(); await run(); turns.set('s', { routes:new Map() }); await run();
  assert.deepEqual(hits.map(h=>h.label), ['primary','backup','backup','backup']);
  assert.ok(hits.every(h => JSON.stringify(h.body) === JSON.stringify(hits[0].body)));
  assert.ok(hits.every(h=>h.path==='/v1/chat/completions' && h.key==='Bearer synthetic-key' && h.body.model==='fixture' && h.body.temperature===.3));
  assert.equal(model.baseUrl, primary);
 } finally { restore?.(); for (const s of servers) { s.closeAllConnections(); await new Promise(r=>s.close(r)); } }
});
