import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const source=path.join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness/resources/app.asar');
const output=path.join(root,'.desktop-candidate/app.asar');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(source);const oldSize=bytes.readUInt32LE(4);const dataStart=8+oldSize;
const header=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(12)).toString());
const manifest=JSON.parse(fs.readFileSync(path.join(root,'core/manifest.json')));
const chunks=[bytes.subarray(dataStart)];let offset=chunks[0].length;const changes=[];
function entry(p){let value=header;for(const part of p.split('/')){value=value.files?.[part];if(!value)throw Error('Missing archive entry: '+p);}return value;}
for(const item of manifest.files){const name='dsh/node_modules/'+item.file;const e=entry(name);if(e.unpacked||e.link)throw Error('Unsupported entry: '+name);const original=bytes.subarray(dataStart+Number(e.offset),dataStart+Number(e.offset)+e.size);if(sha(original)!==item.originalSha256)throw Error('Original checksum mismatch: '+name);const patched=fs.readFileSync(path.join(root,'core/patched',item.file));if(sha(patched)!==item.patchedSha256)throw Error('Patch checksum mismatch');e.offset=String(offset);e.size=patched.length;offset+=patched.length;const blockSize=e.integrity?.blockSize??4194304;const blocks=[];for(let i=0;i<patched.length;i+=blockSize)blocks.push(sha(patched.subarray(i,i+blockSize)));e.integrity={algorithm:'SHA256',hash:sha(patched),blockSize,blocks};chunks.push(patched);changes.push({name,sha256:sha(patched)});}
const json=Buffer.from(JSON.stringify(header));const payload=4+json.length;const aligned=Math.ceil(payload/4)*4;const hp=Buffer.alloc(4+aligned);hp.writeUInt32LE(aligned,0);hp.writeUInt32LE(json.length,4);json.copy(hp,8);const prefix=Buffer.alloc(8);prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(hp.length,4);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,Buffer.concat([prefix,hp,...chunks]));
const out=fs.readFileSync(output);const start=8+out.readUInt32LE(4);for(const {name,sha256} of changes){const e=entry(name);if(sha(out.subarray(start+Number(e.offset),start+Number(e.offset)+e.size))!==sha256)throw Error('Candidate verification failed');}
// Check every other packed leaf still resolves to byte-identical content.
let verified=0;function walk(node,p=''){for(const [n,e] of Object.entries(node.files??{})){const name=p?p+'/'+n:n;if(e.files)walk(e,name);else if(!e.unpacked&&!e.link&&!changes.some(c=>c.name===name)){const a=bytes.subarray(dataStart+Number(e.offset),dataStart+Number(e.offset)+e.size);const b=out.subarray(start+Number(e.offset),start+Number(e.offset)+e.size);if(!a.equals(b))throw Error('Unrelated entry changed: '+name);verified++;}}}walk(header);
const result={source,output,originalSha256:sha(bytes),candidateSha256:sha(out),changes,unchangedPackedEntriesVerified:verified};fs.writeFileSync(path.join(root,'.desktop-candidate/manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
