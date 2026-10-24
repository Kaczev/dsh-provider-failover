import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const names = execFileSync('git', ['diff','--cached','--name-only','--diff-filter=ACMR','-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden = /(^|\/)(node_modules|\.runtime|不入库文件夹|artifacts|\.desktop-backup|\.desktop-candidate|\.env(?:\..*)?)(\/|$)|\.(asar|tgz|log)$/i;
let failed = false;
for (const file of names) {
 if (forbidden.test(file)) { console.error('Forbidden staged path:', file); failed = true; }
 if (/\.(png|svg)$/.test(file)) continue;
 const content = fs.readFileSync(file, 'utf8');
 const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bnpm_[a-zA-Z0-9]{20,}\b/, /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/, /\bsk-[a-zA-Z0-9_-]{20,}\b/];
 if (patterns.some(pattern => pattern.test(content))) { console.error('Potential credential in:', file); failed = true; }
}
if (failed) process.exitCode = 1;
else console.log('PASS staged path and credential-pattern scan:', names.length, 'files; heuristic only');
