import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const dirs=['src','public','tests'];
const files=['package.json','wrangler.jsonc'];
for(const dir of dirs){
  const stack=[new URL(dir+'/',root)];
  while(stack.length){
    const dirUrl=stack.pop();
    for(const ent of fs.readdirSync(dirUrl,{withFileTypes:true})){
      if(ent.isDirectory())stack.push(new URL(ent.name+'/',dirUrl));
      else if(ent.isFile()&&/\.(js|mjs|json|jsonc|css|html|webmanifest|sql|py)$/.test(ent.name))
        files.push(decodeURIComponent(new URL(ent.name,dirUrl).pathname).replace(decodeURIComponent(root.pathname),''));
    }
  }
}
const badStart='<'.repeat(7)+' HEAD';
const badEnd='>'.repeat(7)+' ';
for(const name of files){
  const content=fs.readFileSync(new URL(name,root),'utf8');
  assert(!content.split(/\r?\n/).some(s=>s.trim().startsWith(badStart)||s.trim().startsWith(badEnd)||s.trim()==='='.repeat(7)),`Git merge conflict found: ${name}`);
}
console.log('PASS: no unresolved Git merge markers in deployable project files.');
