const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2] || path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh');
const target = path.resolve(__dirname, '../../.runtime');
let count=0, bytes=0;
function copy(src,dst) {
 const st=fs.statSync(src);
 if(st.isDirectory()) { fs.mkdirSync(dst,{recursive:true}); for(const name of fs.readdirSync(src)) copy(path.join(src,name),path.join(dst,name)); }
 else { fs.copyFileSync(src,dst); count++; bytes+=st.size; }
}
copy(source,target);
console.log(JSON.stringify({target,count,bytes}));
