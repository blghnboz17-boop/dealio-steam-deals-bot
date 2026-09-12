
import 'dotenv/config';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,chmod,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ContainerClient} from '@azure/storage-blob';
import {DefaultAzureCredential} from '@azure/identity';
import {pathToFileURL} from 'node:url';

export async function verifyDatabase(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('SQLite integrity check failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('SQLite foreign-key check failed');
  return {schemaVersion:db.prepare('PRAGMA user_version').get().user_version,
   users:db.prepare('SELECT COUNT(*) n FROM user_config').get().n};
 }finally{db.close();}
}
export async function createConsistentBackup(source,destination){
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,destination);}finally{db.close();}
 await chmod(destination,0o600);
 const verification=await verifyDatabase(destination);
 const digest=createHash('sha256').update(await readFile(destination)).digest('hex');
 return {...verification,sha256:digest,createdAt:new Date().toISOString()};
}
export function privateContainer(url){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||parsed.search)throw new Error('Use an HTTPS container URL without a shared secret');
 return new ContainerClient(url,new DefaultAzureCredential(),{retryOptions:{maxTries:2,tryTimeoutInMs:20000}});
}
async function main(){
 const restore=process.argv.includes('--restore-test');
 const container=privateContainer(process.env.AZURE_BACKUP_CONTAINER_URL??'');
 const properties=await container.getProperties({abortSignal:AbortSignal.timeout(20000)});
 if(properties.blobPublicAccess)throw new Error('Backup container must be private');
 const directory=await mkdtemp(join(tmpdir(),'dealio-recovery-'));
 await chmod(directory,0o700);
 try{
  const database=join(directory,'wishlist.db');
  if(restore){
   const names=[];
   for await(const blob of container.listBlobsFlat({prefix:'daily/'}))if(blob.name.endsWith('.json'))names.push(blob.name);
   const newest=names.sort().at(-1);
   if(!newest)throw new Error('No backup available for restore rehearsal');
   const manifest=JSON.parse((await container.getBlockBlobClient(newest).downloadToBuffer()).toString());
   await container.getBlockBlobClient(newest.replace(/\.json$/,'.db')).downloadToFile(database);
   const hash=createHash('sha256').update(await readFile(database)).digest('hex');
   if(hash!==manifest.sha256)throw new Error('Restored backup checksum mismatch');
   await verifyDatabase(database);
   // Apply current migrations only to the isolated restored copy; never launch Discord.
   const {createDatabase}=await import('../dist/persistence/database.js');
   const migrated=createDatabase(database);migrated.close();
   await verifyDatabase(database);
   await writeHealth('restore',{ok:true,at:new Date().toISOString(),source:newest});
  }else{
   const manifest=await createConsistentBackup(resolve(process.env.DATABASE_PATH??'./data/wishlist.db'),database);
   const name='daily/'+new Date().toISOString().replace(/[:.]/g,'-');
   await container.getBlockBlobClient(name+'.db').uploadFile(database,{abortSignal:AbortSignal.timeout(120000),
     blobHTTPHeaders:{blobContentType:'application/vnd.sqlite3'}});
   const json=JSON.stringify(manifest);
   await container.getBlockBlobClient(name+'.json').upload(json,Buffer.byteLength(json));
   await writeHealth('backup',{ok:true,at:new Date().toISOString(),sha256:manifest.sha256});
  }
 }finally{await rm(directory,{recursive:true,force:true});}
}
async function writeHealth(name,data){
 await mkdir('.runtime',{recursive:true});await writeFile('.runtime/'+name+'.health.json',JSON.stringify(data),{mode:0o600});
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)main().catch(async error=>{
 await writeHealth(process.argv.includes('--restore-test')?'restore':'backup',{ok:false,at:new Date().toISOString()});
 console.error('Backup/recovery failed:',error?.name??'Error');process.exitCode=1;
});
