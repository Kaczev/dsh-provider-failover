import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
test('client bundle uses independent settings section and rejects unsafe draft destinations', () => {
  let definition;
  vm.runInNewContext(fs.readFileSync('plugin/client.js', 'utf8'), { window: { __ModuleLoader__: { load: value => { definition = value; } } }, URL });
  assert.equal(definition.id, 'dsh-provider-failover');
  const client = definition.factory(() => ({ createElement() {} }));
  const payload = { namespaces: [], writable: true };
  assert.equal(client.unwrapSettings({ ok: true, value: payload }), payload);
  const written = { ns: 'fixture', revision: 'r2', value: { providers: {} } };
  assert.equal(client.unwrapSettings({ ok: true, value: written }), written);
  for (const code of ['settings/conflict', 'access/denied']) {
    assert.throws(() => client.unwrapSettings({ ok: false, error: { code, message: 'fixture refusal' } }), /fixture refusal/);
  }
  assert.throws(() => client.unwrapSettings(undefined), /设置请求失败/);
  const baseline = { view: { revision: 'r1', value: { providers: { p: { enabled: false, backups: [] } } } }, providers: [{ id: 'p', primary: 'https://primary.test', label: 'P' }], writable: true };
  const unrelated = structuredClone(baseline);
  unrelated.view.revision = 'r2';
  unrelated.view.value.providers.other = { enabled: true, backups: ['https://other.test'] };
  assert.equal(client.draftConflicts(baseline, unrelated, 'p'), false);
  const changed = structuredClone(unrelated);
  changed.view.value.providers.p.backups.push('https://changed.test');
  assert.equal(client.draftConflicts(baseline, changed, 'p'), true);
  const primaryChanged = structuredClone(baseline);
  primaryChanged.providers[0].primary = 'https://new-primary.test';
  assert.equal(client.draftConflicts(baseline, primaryChanged, 'p'), true);
  assert.equal(client.draftConflicts(baseline, { ...baseline, providers: [] }, 'p'), true);
  assert.equal(client.draftConflicts(baseline, { ...baseline, writable: false }, 'p'), true);
  assert.ok(client.inject.includes('remote.settings'), 'settings endpoint must be explicitly injected');
  const meta = JSON.parse(fs.readFileSync('plugin/package.json', 'utf8'));
  assert.deepEqual(Array.from(client.inject), meta.dsh.client.inject);
  assert.equal(client.normalize('https://EXAMPLE.com/v1/'), 'https://example.com/v1');
  for (const value of ['http://bad.test', 'https://a:b@bad.test', 'https://bad.test?', 'https://bad.test#', '']) assert.throws(() => client.normalize(value));
  const draft = backups => ({ enabled: true, confirmCredentialRecipients: true, backups });
  assert.match(client.validateDraft(draft(['https://primary.test/v1/']), 'https://PRIMARY.test/v1').reason, /主地址/);
  assert.match(client.validateDraft(draft(['https://a.test/', 'https://A.test']), '').reason, /重复/);
  assert.match(client.validateDraft(draft([]), '').reason, /至少/);
  assert.match(client.validateDraft(draft(['https://a.test','https://b.test','https://c.test']), '').reason, /两条/);
  assert.equal(client.validateDraft(draft(['', 'https://b.test']), '').value.backups.join(), 'https://b.test');
  assert.match(client.validateDraft(draft(['', '']), '').reason, /至少/);
  assert.throws(() => resolveConfig({ Config }, { providers: { p: draft(['https://a.test','https://b.test','https://c.test']) } }), /两条/);
  assert.equal(client.validateDraft({ ...draft([]), enabled: false }, '').reason, '');
  let options;
  client.apply({ slots: { inject: (name, callback) => { assert.equal(name, 'settings.section'); callback(); }, register: opts => { options = opts; } } });
  assert.equal(options.id, 'kaczev-provider-line-failover');
});
import { createRouter, eligible, validate, Config } from '../plugin/index.js';
import { resolveConfig } from '../.runtime/node_modules/@deepseek-ai/cordis/lib/index.js';
import { updateVolatile } from '../.runtime/node_modules/@deepseek-ai/cosmokit/lib/index.js';
import { LlmRuntime } from '../.runtime/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
import { PiAiAdapter } from '../.runtime/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
import { streamSimple } from '../.runtime/node_modules/@earendil-works/pi-ai/dist/compat.js';
import { apply as retryApply } from '../.runtime/node_modules/@deepseek-ai/dsh-llm-retry/lib/index.js';
test('volatile providers reload atomically and preserve in-flight snapshots', async () => {
  const entry = backups => ({ enabled: true, confirmCredentialRecipients: true, backups });
  const resolved = resolveConfig({ Config }, { providers: { p: entry(['https://old.test/v1']) } });
  assert.equal(typeof resolved.providers.get, 'function');
  const router = createRouter(resolved);
  const request = () => ({ provider: 'p', transportRequest: {} });
  const fail = async options => {
    for await (const _ of router.stream(options, async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', status: 502 } } };
    })) {}
  };
  const old = request();
  router.baseURL(old, 'primary');
  updateVolatile(resolved.providers, resolveConfig({ Config }, { providers: { p: entry(['https://new.test/v1']) } }).providers);
  router.reload(resolved);
  await fail(old);
  assert.equal(router.baseURL(old, 'primary'), 'https://old.test/v1');
  const fresh = request();
  await fail(fresh);
  assert.equal(router.baseURL(fresh, 'primary'), 'https://new.test/v1');
  assert.throws(() => router.reload({ providers: { p: entry(['http://unsafe.test']) } }));
  const afterInvalid = request();
  await fail(afterInvalid);
  assert.equal(router.baseURL(afterInvalid, 'primary'), 'https://new.test/v1');
  router.reload({ providers: {} });
  assert.equal(router.baseURL(fresh, 'primary'), 'https://new.test/v1');
  assert.equal(router.baseURL(request(), 'primary'), 'primary');
});

test('backup URL validation rejects unsafe and duplicate destinations', () => {
  for (const backups of [[], [''], ['http://backup.test'], ['https://user:pass@backup.test'], ['https://backup.test?q=1'], ['https://backup.test/#anchor'], ['https://BACKUP.test/v1/', 'https://backup.test/v1']]) {
    assert.throws(() => validate({ providers: { p: { enabled: true, confirmCredentialRecipients: true, backups } } }));
  }
});

const servers=[];const hits=[];
async function server(handler){const s=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;hits.push({port:s.address().port,url:req.url,authorization:req.headers.authorization,body:JSON.parse(body)});handler(req,res);});await new Promise(r=>s.listen(0,'127.0.0.1',r));servers.push(s);return `http://127.0.0.1:${s.address().port}/v1`;}
const success=(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'mock',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
const fail=status=>(_req,res)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'mock failure',type:'mock'}}));};
function setup(primary,backups){const router=createRouter({allowLocalHttp:true,providers:{'four-router':{enabled:true,confirmCredentialRecipients:true,backups}}});
 const model={id:'mock-model',name:'mock',api:'openai-completions',provider:'four-router',baseUrl:primary,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32000,maxTokens:1000};
 const adapter=new PiAiAdapter({resolveBaseURL:(o,p)=>router.baseURL(o,p),resolveApiKey:async()=> 'local-test-key'});
 adapter.current=()=>({models:{streamSimple}});adapter.profileOf=()=>({apiKeyEnv:'TEST_KEY',streamIdleTimeoutMs:500,headers:{},configuredMaxTokens:new Map()});adapter.modelOf=()=>model;
 return {router,adapter,model};}
function retryHost(){let projection;let state={};let listener;const ctx={sessionProjections:{register(p){projection=p;},stateOf(){return state;}},on(_n,f){listener=f;return()=>{};},effect(){},logger:{warn(){}}};retryApply(ctx);const agent={session:{append(type,data){state=projection.apply(state,{type,data});}}};return {recover:(failure,policy,signal)=>listener({agent,turn:0,step:0,provider:'four-router',failure,retryPolicy:policy,signal},async()=>undefined)};}
const normal={mode:'normal',maxRetries:2,retryableCodes:['SERVER','TRANSPORT','TIMEOUT','RATE_LIMIT'],initialDelayMs:0,maxDelayMs:1,jitterRatio:0};
async function run(env,{policy=normal,signal=new AbortController().signal,token=Object.freeze({}),purpose}={}){const retry=retryHost();const attempts=[];for(;;){const options=Object.freeze({provider:'four-router',model:'mock-model',messages:[{role:'user',content:[{type:'text',text:'local mock'}]}],toolHistory:[],temperature:0.3,maxTokens:32,transportRequest:token,signal,...purpose?{purpose}:{}});let finish;for await(const chunk of env.router.stream(options,()=>LlmRuntime.prototype.adapterStream.call({forAdapter:o=>o},options,{registration:{adapter:env.adapter},config:options,modelInfo:{inputModalities:['text']},dispatch:o=>env.adapter.stream(o)}))){if(chunk.type==='finish')finish=chunk.reason;}attempts.push(finish);if(process.env.DEBUG_FAILOVER) console.log(finish);if(attempts.length>8) throw Error('test safety limit');if(finish?.kind!=='error')return attempts;if(!await retry.recover(finish.failure,policy,signal))return attempts;}}
test('local integration suite',async t=>{try{
 const backup=await server(success);
 await t.test('502 switches next host retry; path/model/key/params preserved; new call resets',async()=>{const primary=await server(fail(502));const e=setup(primary,[backup]);const start=hits.length;const result=await run(e);assert.equal(result.length,2);assert.equal(result[1].kind,'stop');assert.deepEqual(hits.slice(start).map(h=>h.url),['/v1/chat/completions','/v1/chat/completions']);assert.equal(hits.at(-1).authorization,'Bearer local-test-key');assert.equal(hits.at(-1).body.model,'mock-model');assert.equal(hits.at(-1).body.temperature,0.3);assert.equal(e.model.baseUrl,primary);await run(e);assert.equal(hits.at(-2).port,Number(new URL(primary).port));});
 await t.test('all backups fail; host retry budget unchanged; last route retained',async()=>{const a=await server(fail(503));const b=await server(fail(504));const e=setup(a,[b]);const start=hits.length;assert.equal((await run(e)).length,3);assert.deepEqual(hits.slice(start).map(h=>h.port),[Number(new URL(a).port),Number(new URL(b).port),Number(new URL(b).port)]);});
 await t.test('always mode also switches',async()=>{const a=await server(fail(502));assert.equal((await run(setup(a,[backup]),{policy:{...normal,mode:'always'}})).length,2);});
 await t.test('401/403/400/context/429 never switch',async()=>{for(const status of [401,403,400,429]){const a=await server(fail(status));const start=hits.length;await run(setup(a,[backup]));assert(hits.slice(start).every(h=>h.port===Number(new URL(a).port)));}assert.equal(eligible({code:'CONTEXT_WINDOW_EXCEEDED',message:'502'},null),false);});
 await t.test('408 switches through real mapping',async()=>{const a=await server(fail(408));assert.equal((await run(setup(a,[backup]))).length,2);});
 await t.test('connection reset switches',async()=>{const a=await server(req=>req.socket.destroy());assert.equal((await run(setup(a,[backup]))).length,2);});
 await t.test('timeout switches',async()=>{const a=await server(()=>{});assert.equal((await run(setup(a,[backup]))).length,2);});
 await t.test('cancel does not use backup',async()=>{const a=await server(()=>{});const start=hits.length;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),40);try{await run(setup(a,[backup]),{signal:controller.signal});}finally{clearTimeout(timer);}assert(hits.slice(start).every(h=>h.port===Number(new URL(a).port)));});
 await t.test('concurrent request isolation',async()=>{let count=0;const a=await server((req,res)=> (++count===1?fail(502):success)(req,res));const e=setup(a,[backup]);const r=await Promise.all([run(e),run(e)]);assert.deepEqual(r.map(x=>x.length).sort(),[1,2]);});
 await t.test('partial SSE interruption fails closed, even always',async()=>{const a=await server((_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'partial'},finish_reason:null}]})+'\n\n');setTimeout(()=>res.destroy(),30);});const start=hits.length;await assert.rejects(run(setup(a,[backup]),{policy:{...normal,mode:'always'}}),{code:'FAILOVER_PARTIAL_STREAM'});assert.equal(hits.length-start,1);});
 await t.test('tool/reasoning fragments fail closed',async()=>{for(const type of ['reasoning','tool-call']){const r=createRouter({providers:{p:{enabled:true,confirmCredentialRecipients:true,backups:['https://backup.test/v1']}}});await assert.rejects(async()=>{for await(const _ of r.stream({provider:'p',transportRequest:{}},async function*(){yield {type:'block-start',blockType:type};yield {type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT'}}};})){}},{code:'FAILOVER_PARTIAL_STREAM'});}});
 await t.test('auxiliary purposes never consume agent route state',async()=>{const e=setup('https://primary.test/v1',['https://backup.test/v1']);for(const purpose of ['session-title','compaction'])assert.equal(e.router.baseURL({provider:'four-router',transportRequest:{},purpose},'https://primary.test/v1'),'https://primary.test/v1');});
 await t.test('multiple backups advance in order; trailing slash and nested URL path',async()=>{const a=await server(fail(502));const b=await server(fail(503));const start=hits.length;const result=await run(setup(a,[b,backup+'/proxy/']));assert.equal(result.length,3);assert.deepEqual(hits.slice(start).map(h=>h.port),[Number(new URL(a).port),Number(new URL(b).port),Number(new URL(backup).port)]);assert.equal(hits.at(-1).url,'/v1/proxy/chat/completions');});
 await t.test('always retries exhausted routes until cancellation; no extra plugin loop',async()=>{const a=await server(fail(502));const b=await server(fail(504));const c=new AbortController();const timer=setTimeout(()=>c.abort(),100);const start=hits.length;try{await run(setup(a,[b]),{signal:c.signal,policy:{...normal,mode:'always',initialDelayMs:30,maxDelayMs:30}});}finally{clearTimeout(timer);}assert(hits.length-start>=2);assert(hits.slice(start+1).every(h=>h.port===Number(new URL(b).port)));});
 await t.test('disabled/unconfigured providers remain primary',()=>{const r=createRouter({providers:{'four-router':{enabled:false}}});assert.equal(r.baseURL({provider:'four-router',transportRequest:{}},'primary'),'primary');assert.equal(r.baseURL({provider:'other',transportRequest:{}},'other'),'other');});
 await t.test('trust validation / status-body confusion',()=>{assert.doesNotThrow(()=>validate({providers:{p:{enabled:true,backups:['https://backup.test']}}}));assert.throws(()=>validate({providers:{p:{enabled:true,confirmCredentialRecipients:true,backups:['http://evil.test']}}}));assert.equal(eligible({code:'SERVER',message:'500 body contains 502'}),false);});
 }finally{for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}}});
