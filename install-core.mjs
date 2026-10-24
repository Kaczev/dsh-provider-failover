import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const [action,target]=process.argv.slice(2);
if(!['check','apply','restore'].includes(action)||!target) throw Error('Usage: node install-core.mjs check|apply|restore <unpacked-dsh-root>');
const root=fs.realpathSync(target);
if(root.includes('.asar')) throw Error('ASAR editing is intentionally unsupported. Use an unpacked DSH runtime, not the running Desktop archive.');
const manifest=JSON.parse(fs.readFileSync(path.join(here,'core/manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!==manifest.version) throw Error('DSH version mismatch; refusing to modify');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
// Verify every file before any write. Never overwrite local changes.
const operations=manifest.files.map(entry=>{
 const dest=path.join(root,'node_modules',entry.file);
 const actual=digest(fs.readFileSync(dest));
 if(![entry.originalSha256,entry.patchedSha256].includes(actual)) throw Error('Unexpected file checksum: '+entry.file);
 const mode=action==='restore'?'original':'patched';
 const source=path.join(here,'core',mode,entry.file);
 const bytes=fs.readFileSync(source);
 if(digest(bytes)!==entry[mode==='original'?'originalSha256':'patchedSha256']) throw Error('Artifact checksum mismatch');
 return {dest,bytes,file:entry.file,actual};
});
if(action!=='check') for(const op of operations) fs.writeFileSync(op.dest,op.bytes);
console.log(JSON.stringify({action,root,files:operations.map(op=>({file:op.file,sha256:action==='check'?op.actual:digest(op.bytes)}))},null,2));
