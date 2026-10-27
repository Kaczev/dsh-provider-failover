import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installTransport, normalizeFailure } from '../plugin/transport.js';

const serverMessage = 'An error occurred while processing your request. Please try again later. (server_error)';
test('only the exact known PI_AI server error is normalized without mutating diagnostics', () => {
 const failure = Object.freeze({ code: 'PI_AI_ERROR', message: serverMessage, requestId: 'fixture', providerRetryAfterMs: 5 });
 assert.deepEqual(normalizeFailure(failure), { ...failure, code: 'SERVER' });
 for (const value of [
  { code: 'PI_AI_ERROR', message: 'unsupported response status (server_error)' },
  { code: 'PI_AI_ERROR', message: serverMessage.replace(' (server_error)', '') },
  { code: 'PI_AI_ERROR', message: serverMessage, status: 401 },
  ...['AUTH', 'RATE_LIMIT', 'INVALID_REQUEST', 'ABORTED', 'SERVER'].map(code => ({ code, message: serverMessage })),
 ]) assert.equal(normalizeFailure(value), value);
 assert.equal(failure.code, 'PI_AI_ERROR');
});

for (const mode of ['empty', 'partial', 'cancelled', 'disabled', 'auxiliary']) test(`server_error recovery boundary: ${mode}`, async () => {
 const seen = [], failure = Object.freeze({ code: 'PI_AI_ERROR', message: serverMessage });
 class Adapter {
  profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
  modelOf() { return { baseUrl: 'https://primary.test' }; }
  async *streamWithSnapshot() {
   const url = this.modelOf().baseUrl; seen.push(url);
   if (url !== 'https://primary.test') { yield { type: 'finish', reason: { kind: 'stop' } }; return; }
   if (mode !== 'empty') yield { type: 'tool-call-delta', arguments: '{' };
   yield { type: 'finish', reason: { kind: 'error', failure } };
  }
 }
 const restore = installTransport(Adapter, () => ({ p: { enabled: mode !== 'disabled', backups: ['https://backup.test'] } }), new Map([['s', { routes: new Map() }]]));
 const controller = new AbortController(); if (mode === 'cancelled') controller.abort();
 try {
  const result = []; for await (const chunk of new Adapter().streamWithSnapshot({ sessionId: 's', provider: 'p', signal: controller.signal, purpose: mode === 'auxiliary' ? 'title' : undefined }, {})) result.push(chunk);
  assert.equal(result.filter(chunk => chunk.type === 'finish').length, 1);
  assert.deepEqual(seen, mode === 'empty' ? ['https://primary.test', 'https://backup.test'] : ['https://primary.test']);
  if (mode === 'empty') assert.equal(result.at(-1).reason.kind, 'stop');
  else if (mode === 'partial') assert.deepEqual(result.at(-1).reason.failure, { ...failure, code: 'SERVER' });
  else assert.equal(result.at(-1).reason.failure, failure);
 } finally { restore(); }
});

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

test('partial output preserves failure and waits for host retry before switching', async () => {
 for (const type of ['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end']) {
  const seen = [];
  const failure = { code: 'TRANSPORT', message: 'socket terminated', status: 502, requestId: 'fixture-request' };
  class Adapter {
   profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
   modelOf() { return { baseUrl: 'https://primary.test' }; }
   async *streamWithSnapshot() {
    const url = this.modelOf().baseUrl; seen.push(url);
    if (url === 'https://primary.test') {
     yield { type, text: 'partial' };
     yield { type: 'finish', reason: { kind: 'error', failure } };
    } else { yield { type: 'text-delta', text: 'replacement' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
   }
  }
  const restore = installTransport(Adapter, () => ({ p: { enabled: true, backups: ['https://backup.test'] } }), new Map([['s', { routes: new Map() }]]));
  try {
   const adapter = new Adapter();
   const consume = async () => { const chunks = []; for await (const chunk of adapter.streamWithSnapshot({ sessionId: 's', provider: 'p' }, {})) chunks.push(chunk); return chunks; };
   const first = await consume();
   assert.equal(first.at(-1).reason.failure, failure);
   assert.deepEqual(seen, ['https://primary.test'], 'no inline replay after partial output');
   assert.equal(first.filter(chunk => chunk.type === 'finish').length, 1);
   const second = await consume(); // A new invocation represents the host-authorized retry.
   assert.equal(second.at(-1).reason.kind, 'stop');
   assert.deepEqual(seen, ['https://primary.test', 'https://backup.test']);
  } finally { restore(); }
 }
});

test('partial non-switchable failures and cancellation retain original outcomes', async () => {
 for (const code of ['AUTH', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'RATE_LIMIT', 'ABORTED', 'TRANSPORT']) {
  const cancelled = code === 'TRANSPORT';
  const failure = { code, message: 'original failure' };
  const seen = [];
  class Adapter {
   profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
   modelOf() { return { baseUrl: 'https://primary.test' }; }
   async *streamWithSnapshot() { seen.push(this.modelOf().baseUrl); yield { type: 'text-delta', text: 'partial' }; yield { type: 'finish', reason: { kind: 'error', failure } }; }
  }
  const restore = installTransport(Adapter, () => ({ p: { enabled: true, backups: ['https://backup.test'] } }), new Map([['s', { routes: new Map() }]]));
  const controller = new AbortController(); if (cancelled) controller.abort();
  try {
   const adapter = new Adapter();
   for (let attempt = 0; attempt < 2; attempt++) {
    const chunks = []; for await (const chunk of adapter.streamWithSnapshot({ sessionId: 's', provider: 'p', signal: controller.signal }, {})) chunks.push(chunk);
    assert.equal(chunks.at(-1).reason.failure, failure);
   }
   assert.deepEqual(seen, ['https://primary.test', 'https://primary.test']);
  } finally { restore(); }
 }
});
