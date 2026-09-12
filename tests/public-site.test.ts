
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
it('publishes only reviewed public files and resolves every local page link',()=>{
 execFileSync(process.execPath,['scripts/build-public-site.mjs']);
 const root=resolve('.runtime/public-site'),files=readdirSync(root);
 expect(files).toHaveLength(10);expect(files.some(f=>f.endsWith('.md'))).toBe(false);
 for(const file of files.filter(f=>f.endsWith('.html'))){
  const text=readFileSync(resolve(root,file),'utf8');
  expect(text).toContain('lang=');
  for(const match of text.matchAll(/(?:href|src)="([^"]+)"/g)){
   if(/^(https?:|mailto:|#)/.test(match[1]))continue;
   expect(existsSync(resolve(dirname(resolve(root,file)),match[1]))).toBe(true);
  }
 }
});
