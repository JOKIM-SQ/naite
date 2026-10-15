import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** @param {string} folder */
async function check(folder){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);
    if(entry.isDirectory()&&entry.name!=='vendor')await check(path);
    else if(entry.isFile()&&entry.name.endsWith('.mjs')){
      const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
      if(result.status!==0){console.error(result.stderr);process.exit(1);}
    }
  }
}
for(const folder of ['public','scripts','test'])await check(fileURLToPath(new URL(`../${folder}`,import.meta.url)));
console.log('All application, script and test modules pass syntax checks');
