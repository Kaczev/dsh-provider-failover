import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installTransport } from '../plugin/transport.js';

test('backoff timetable, new-turn-only probes, stable recovery reset and backup stickiness', async () => {
 let time=0, primaryOK=false, backupOneOK=true;
 const seen=[], turns=new Map();
 class Adapter {
  profileOf(){return {apiKeyEnv:'FIXTURE'};}
  modelOf(){return {baseUrl:'main'};}
  async *streamWithSnapshot(options,snapshot){
   assert.equal(options, input); assert.equal(snapshot, snap);
   const url=this.modelOf().baseUrl; seen.push(url);
   yield {type:'finish',reason:(url==='main'?primaryOK:url==='one'?backupOneOK:true)?{kind:'stop'}:{kind:'error',failure:{code:'TRANSPORT'}}};
  }
 }
 const input=Object.freeze({sessionId:'s',provider:'p',model:'m',temperature:.3}),snap=Object.freeze({});
 const adapter=new Adapter(), restore=installTransport(Adapter,()=>({p:{enabled:true,backups:['one','two']}}),turns,()=>time);
 const run=async(newTurn=true)=>{if(newTurn)turns.set('s',{routes:new Map()});const start=seen.length;for await(const _ of adapter.streamWithSnapshot(input,snap)){}return seen.slice(start);};
 try {
  assert.deepEqual(await run(),['main','one']);
  time=29999;assert.deepEqual(await run(),['one']);
  time=30000;assert.deepEqual(await run(false),['one']);
  assert.deepEqual(await run(),['main','one']);
  for(const t of [90000,210000,450000,750000]){time=t;assert.deepEqual(await run(),['main','one']);}
  time=1050000;primaryOK=true;assert.deepEqual(await run(),['main']);
  // A brief recovery must not reset the capped failure delay.
  time+=1;primaryOK=false;assert.deepEqual(await run(),['main','one']);
  time+=299999;assert.deepEqual(await run(),['one']);
  time+=1;primaryOK=true;assert.deepEqual(await run(),['main']);
  time+=300000;assert.deepEqual(await run(),['main']);
  primaryOK=false;assert.deepEqual(await run(),['main','one']);
  time+=30000;assert.deepEqual(await run(),['main','one']);
  // With primary cooling, backup 1 failure moves to backup 2 and stays there.
  backupOneOK=false;assert.deepEqual(await run(),['one','two']);
  time+=30000;backupOneOK=true;assert.deepEqual(await run(),['two']);
 } finally {restore();}
});
