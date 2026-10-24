import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installTransport } from '../plugin/transport.js';
import { createStatusChannel, displayURL } from '../plugin/route-status.js';

test('status follows both backups and primary recovery without changing URL selection', async () => {
 let time = 0, fail = true;
 const events = [], turns = new Map([['s', { routes: new Map() }]]);
 class Adapter {
  profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
  modelOf() { return { baseUrl: 'https://primary.test/v1' }; }
  async *streamWithSnapshot() {
   if (fail && !this.modelOf().baseUrl.includes('backup2')) yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSPORT' } } };
   else { yield { type: 'text-delta', text: 'ok' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
  }
 }
 const dispose = installTransport(Adapter, () => ({ p: { enabled: true, backups: ['https://backup1.test/v1','https://backup2.test/v1'] } }), turns, () => time, (id, state) => events.push([id, state]));
 try {
  const adapter = new Adapter(), options = { sessionId: 's', provider: 'p' };
  for await (const _ of adapter.streamWithSnapshot(options, {})) {}
  assert.deepEqual(events.filter(([,v]) => v).map(([,v]) => [v.phase,v.index]), [['connecting',1],['connecting',2],['active',2],['active',2]]);
  assert.equal(events.at(-1)[1].url, 'https://backup2.test/v1');
  time = 30_001; fail = false; turns.set('s', { routes: new Map() }); events.length = 0;
  for await (const _ of adapter.streamWithSnapshot(options, {})) {}
  assert.deepEqual(events.filter(([,v]) => v).map(([,v]) => [v.phase,v.index]), [['connecting',0],['active',0],['active',0]]);
  for (const newTurn of [false, true]) {
   if (newTurn) turns.set('s', { routes: new Map() });
   events.length = 0;
   for await (const _ of adapter.streamWithSnapshot(options, {})) {}
   assert.ok(events.length > 0);
   assert.ok(events.every(([,v]) => v?.phase === 'active' && v.index === 0), 'stable primary must not re-enter connecting');
  }
 } finally { dispose(); }
});

test('failed, thrown, cancelled and early-closed streams clear transient state; auxiliary ignored', async () => {
 for (const mode of ['failure','throw','cancel','close','empty']) {
  const events = [], turns = new Map([['s', { routes: new Map() }]]), abort = new AbortController();
  class Adapter {
   profileOf() { return { apiKeyEnv: 'FIXTURE' }; }
   modelOf() { return { baseUrl: 'https://primary.test' }; }
   async *streamWithSnapshot() {
    if (mode === 'throw') throw Error('fixture');
    if (mode === 'empty') return;
    if (mode === 'cancel') abort.abort();
    yield mode === 'close' ? { type: 'text-delta', text: 'x' } : { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } };
   }
  }
  const dispose = installTransport(Adapter, () => ({}), turns, Date.now, (id, state) => events.push(state));
  try {
   try { for await (const _ of new Adapter().streamWithSnapshot({sessionId:'s',provider:'p',signal:abort.signal}, {})) { if (mode === 'close') break; } } catch (error) { assert.equal(mode, 'throw'); }
   assert.ok(events.every(value => value?.phase !== 'connecting')); assert.equal(events.at(-1), null);
   events.length = 0;
   try { for await (const _ of new Adapter().streamWithSnapshot({sessionId:'s',provider:'p',purpose:'title'}, {})) {} } catch {}
   assert.equal(events.length, 0);
  } finally { dispose(); }
 }
});

test('first-request hint waits 1000ms, clears on response/abort, and skips tool continuations', async t => {
 t.mock.timers.enable({apis:['setTimeout']});
 const events = [], turns = new Map([['s',{routes:new Map()}]]);
 let release;
 class Adapter {
  modelOf() { return {baseUrl:'https://primary.test'}; }
  async *streamWithSnapshot() {
   await new Promise(resolve => { release = resolve; });
   yield {type:'text-delta',text:'ok'};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 const dispose = installTransport(Adapter, () => ({}), turns, Date.now, (_id,value) => events.push(value));
 const adapter = new Adapter();
 const request = async signal => { for await (const _ of adapter.streamWithSnapshot({sessionId:'s',provider:'p',signal},{})) {} };
 try {
  let running = request();
  t.mock.timers.tick(999); assert.equal(events.length,0);
  t.mock.timers.tick(1); assert.equal(events.at(-1).phase,'connecting');
  release(); await running; assert.equal(events.at(-1).phase,'active');
  events.length=0; running=request(); t.mock.timers.tick(5000);
  assert.equal(events.length,0,'tool continuation must not show connecting');
  release(); await running;
  turns.set('s',{routes:new Map()}); events.length=0;
  running=request(); t.mock.timers.tick(500); release(); await running;
  t.mock.timers.tick(5000); assert.ok(events.every(value => value?.phase==='active'),'fast response cancels timer');
  turns.set('s',{routes:new Map()}); events.length=0;
  const abort=new AbortController(); running=request(abort.signal); abort.abort();
  t.mock.timers.tick(5000); assert.equal(events.at(-1),null);
  assert.ok(events.every(value=>value?.phase!=='connecting')); release(); await running;
 } finally { dispose(); t.mock.timers.reset(); }
});

test('SSE snapshot, updates, session isolation, cancellation and redacted URLs', async () => {
 const channel = createStatusChannel();
 assert.equal(displayURL('https://user:secret@example.test/v1?api_key=secret#secret'), 'https://example.test/v1');
 channel.publish('a', {phase:'active',index:1,url:'https://backup.test/v1?secret=x'});
 const response = channel.fetch(new Request('http://localhost/status?sessionId=a'));
 assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
 const reader = response.body.getReader(), decoder = new TextDecoder();
 assert.match(decoder.decode((await reader.read()).value), /backup.test\/v1/);
 channel.publish('b', {phase:'active',index:2,url:'https://other.test'});
 channel.publish('a', {phase:'connecting',index:0,url:'https://main.test'});
 assert.match(decoder.decode((await reader.read()).value), /connecting/);
 channel.publish('a', null);
 const restored = JSON.parse(decoder.decode((await reader.read()).value).slice(6));
 assert.equal(restored.phase, 'active'); assert.equal(restored.index, 1);
 assert.equal(restored.url, 'https://backup.test/v1');
 // An attempted-but-never-confirmed route must not become a successful route.
 channel.publish('fresh', {phase:'connecting',index:2,url:'https://unconfirmed.test'});
 channel.publish('fresh', null);
 const fresh = channel.fetch(new Request('http://localhost/status?sessionId=fresh')).body.getReader();
 assert.equal(decoder.decode((await fresh.read()).value), 'data: null\n\n');
 await fresh.cancel();
 await reader.cancel();
 const abort = new AbortController();
 const aborted = channel.fetch(new Request('http://localhost/status?sessionId=a', {signal:abort.signal})).body.getReader();
 await aborted.read(); abort.abort(); assert.equal((await aborted.read()).done, true);
 const unloaded = channel.fetch(new Request('http://localhost/status?sessionId=a')).body.getReader();
 await unloaded.read(); channel.dispose(); assert.equal((await unloaded.read()).done, true);
 assert.equal(channel.fetch(new Request('http://localhost/status')).status,400);
});
