import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
for (const name of ['README.md', 'LICENSE']) {
 const source = fs.readFileSync(path.join(root, name));
 fs.writeFileSync(path.join(root, 'plugin', name), source);
 if (!source.equals(fs.readFileSync(path.join(root, 'plugin', name)))) throw Error('Sync mismatch: ' + name);
}
console.log('PASS README and LICENSE synchronized byte-for-byte');
