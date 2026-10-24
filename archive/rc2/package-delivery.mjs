import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const entries=['README.md','config.example.yml','plugin','core','install-core.mjs','prepare-core.mjs','extract-runtime.cjs','test.mjs','verify-deployment.mjs','test-results.txt','kaczev-dsh-provider-line-failover-0.1.0.tgz'];
// tar is bundled with current Windows; zip via PowerShell's native archive cmdlet.
const files=entries.map(p=>"'"+path.join(root,p).replaceAll("'","''")+"'").join(',');
const target=path.join(root,'dsh-provider-failover-0.1.0.zip');
const script=`Compress-Archive -LiteralPath ${files} -DestinationPath '${target.replaceAll("'","''")}' -Force`;
const result=spawnSync('pwsh',['-NoProfile','-Command',script],{stdio:'inherit'});
if(result.status!==0)throw Error('Archive failed');
console.log(target,fs.statSync(target).size);
