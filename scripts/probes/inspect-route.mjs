import fs from 'node:fs';import path from 'node:path';import {parse} from '../../.runtime/node_modules/yaml/dist/index.js';
const dir=process.env.DSH_PROFILE_DIR;let found=[];
function walk(v,p=[]){if(!v||typeof v!=='object')return;if(v.providers?.['four-router'])found.push({location:p.join('.'),profile:v.providers['four-router']});for(const [k,c]of Object.entries(v))walk(c,[...p,k]);}
for(const f of ['cordis.yml','cordis.patch.yml'])walk(parse(fs.readFileSync(path.join(dir,f),'utf8')),[f]);
console.log(JSON.stringify(found.map(x=>({location:x.location,keys:Object.keys(x.profile),baseURL:x.profile.baseURL,api:x.profile.api,apiKeyEnv:x.profile.apiKeyEnv,models:x.profile.models?.map(m=>({id:m.id}))})),null,2));
