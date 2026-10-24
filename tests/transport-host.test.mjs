import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context, resolveConfig } from '../.runtime/node_modules/@deepseek-ai/cordis/lib/index.js';
import { apply, Config } from '../plugin/index.js';

test('host apply uses Cordis agent/request turn events, isolates sessions and unwinds wrapper', async () => {
 const ctx = new Context(), seen = [];
 class Adapter {
  profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
  modelOf() { return Object.freeze({ baseUrl: 'https://primary.test' }); }
  async *streamWithSnapshot(options) {
   const url = this.modelOf().baseUrl; seen.push([options.sessionId, url]);
   yield { type:'finish', reason: url === 'https://primary.test' ? {kind:'error',failure:{code:'TRANSPORT'}} : {kind:'stop'} };
  }
 }
 const original = Adapter.prototype.streamWithSnapshot;
 ctx.provide('settings', { configure: () => () => {} });
 ctx.provide('configEditor', { entries: () => [{options:{name:'@deepseek-ai/dsh-llm-pi-ai'},moduleNamespace:{PiAiAdapter:Adapter}}] });
 const config = resolveConfig({ Config }, {providers:{p:{enabled:true,backups:['https://backup.test']}}});
 try {
  await apply(ctx, config);
  const agent = id => ({session:{id}}), a = agent('a'), b = agent('b');
  const configResult = Object.freeze({provider:'p',model:'fixture'});
  const adapter = new Adapter();
  const request = async (who, turn, step) => {
   assert.equal(await ctx.waterfall('agent/request', {agent:who,turn,step}, async()=>configResult), configResult);
   for await (const _ of adapter.streamWithSnapshot({provider:'p',sessionId:who.session.id}, {})) {}
  };
  await request(a,0,0); await request(a,0,1); await request(b,0,0); await request(a,1,0);
  assert.deepEqual(seen, [['a','https://primary.test'],['a','https://backup.test'],['a','https://backup.test'],['b','https://backup.test'],['a','https://backup.test']]);
  ctx.emit('agent/disposed', {agent:a});
  await request(a,1,1);
  assert.deepEqual(seen.slice(-1), [['a','https://backup.test']]);
 } finally { await ctx.fiber.dispose(); }
 assert.equal(Adapter.prototype.streamWithSnapshot, original);
});
