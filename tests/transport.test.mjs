import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installTransport } from '../plugin/transport.js';

test('memory wrapper switches within turn, resets next turn and restores prototype', async () => {
 const seen = [];
 const model = Object.freeze({ baseUrl: 'https://primary.test' });
 class Adapter {
  profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
  modelOf() { return model; }
  async *streamWithSnapshot(options) {
   const url = this.modelOf().baseUrl; seen.push(url);
   yield { type: 'finish', reason: url === model.baseUrl ? { kind: 'error', failure: { code: 'TRANSPORT' } } : { kind: 'stop' } };
  }
 }
 const original = Adapter.prototype.streamWithSnapshot;
 const turns = new Map([['s', { routes: new Map() }]]);
 const restore = installTransport(Adapter, () => ({ p: { enabled: true, backups: ['https://backup.test'] } }), turns);
 try {
  const adapter = new Adapter();
  const call = async () => { const chunks = []; for await (const chunk of adapter.streamWithSnapshot({ sessionId: 's', provider: 'p' }, {})) chunks.push(chunk); return chunks; };
  assert.equal((await call()).at(-1).reason.kind, 'stop');
  await call();
  turns.set('s', { routes: new Map() });
  await call();
  assert.deepEqual(seen, ['https://primary.test','https://backup.test','https://backup.test','https://backup.test']);
  assert.equal(model.baseUrl, 'https://primary.test');
 } finally { restore(); }
 assert.equal(Adapter.prototype.streamWithSnapshot, original);
});

test('memory wrapper exhausts ordered backups and refuses auth errors', async () => {
 for (const failure of [{code:'TRANSPORT'}, {code:'AUTH'}, {code:'RATE_LIMIT',status:429}]) {
  const seen=[];
  class Adapter {
   profileOf() { return {apiKeyEnv:'FIXTURE'}; }
   modelOf() { return {baseUrl:'https://primary.test'}; }
   async *streamWithSnapshot() { seen.push(this.modelOf().baseUrl); yield {type:'finish',reason:{kind:'error',failure}}; }
  }
  const restore=installTransport(Adapter,()=>({p:{enabled:true,backups:['https://one.test','https://two.test']}}),new Map([['s',{routes:new Map()}]]));
  try {
   const chunks=[]; for await(const c of new Adapter().streamWithSnapshot({provider:'p',sessionId:'s'},{})) chunks.push(c);
   assert.deepEqual(seen,failure.code==='TRANSPORT'?['https://primary.test','https://one.test','https://two.test']:['https://primary.test']);
   assert.equal(chunks.length,1);
   if (failure.code === 'TRANSPORT') {
    const adapter = new Adapter();
    seen.length = 0;
    for await (const _ of adapter.streamWithSnapshot({provider:'p',sessionId:'s'},{})) {}
    // The existing turn remembers that all lines are cooling, even for a new instance.
    const count = seen.length;
    for await (const _ of adapter.streamWithSnapshot({provider:'p',sessionId:'s'},{})) {}
    assert.equal(seen.length, count);
   }
  } finally {restore();}
 }
});

test('memory wrapper never replays visible output or cancellation', async () => {
 for (const cancelled of [false, true]) {
  let calls = 0;
  class Adapter {
   profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
   modelOf() { return { baseUrl: 'https://primary.test' }; }
   async *streamWithSnapshot() { calls++; yield { type: 'text-delta', text: 'partial' }; yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } } }; }
  }
  const restore = installTransport(Adapter, () => ({ p: { enabled: true, backups: ['https://backup.test'] } }), new Map([['s', { routes: new Map() }]]));
  const controller = new AbortController(); if (cancelled) controller.abort();
  try {
   const consume = async () => { for await (const _ of new Adapter().streamWithSnapshot({ sessionId: 's', provider: 'p', signal: controller.signal }, {})) {} };
   if (cancelled) await consume(); else await assert.rejects(consume(), { code: 'FAILOVER_PARTIAL_STREAM' });
   assert.equal(calls, 1);
  } finally { restore(); }
 }
});
