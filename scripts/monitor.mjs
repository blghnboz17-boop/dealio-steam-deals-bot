
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {LogsIngestionClient} from '@azure/monitor-ingestion';
import {DefaultAzureCredential} from '@azure/identity';
const now=Date.now();
const age=value=>value?Math.max(0,(now-Date.parse(value))/1000):999999999;
const read=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};
const heartbeat=await read('.runtime/bot.health.json'),savedBackup=await read('.runtime/backup.health.json');
const data={TimeGenerated:new Date(now).toISOString(),Application:process.env.DISCORD_CLIENT_ID,
 HeartbeatAgeSeconds:age(heartbeat?.heartbeatAt),DiscordReady:heartbeat?.phase==='ready'&&heartbeat?.discordReady===true,
 ScanAgeSeconds:0,QueueAgeSeconds:0,BackupAgeSeconds:age(savedBackup?.at),BackupOk:savedBackup?.ok===true};
let db;
try{
 db=new DatabaseSync(process.env.DATABASE_PATH??'./data/wishlist.db',{readOnly:true,timeout:2000});
 const check=db.prepare(`SELECT MIN(COALESCE(last_success_completed_at,config.created_at)) at FROM user_config config
   LEFT JOIN check_state state ON state.discord_user_id=config.discord_user_id WHERE config.enabled=1`).get();
 const queue=db.prepare(`SELECT MIN(n.created_at) at FROM notification_log n JOIN user_config u ON u.discord_user_id=n.discord_user_id
   WHERE u.enabled=1 AND n.config_version=u.config_version AND n.status IN ('candidate','failed','sending')`).get();
 data.ScanAgeSeconds=check.at?age(check.at):0;data.QueueAgeSeconds=queue.at?age(queue.at):0;
}finally{db?.close();}
if(process.argv.includes('--preview'))console.log(JSON.stringify(data));
else{
 const client=new LogsIngestionClient(process.env.AZURE_MONITOR_ENDPOINT,new DefaultAzureCredential());
 await client.upload(process.env.AZURE_MONITOR_RULE_ID,process.env.AZURE_MONITOR_STREAM??'Custom-DealioHealth',[data],
   {abortSignal:AbortSignal.timeout(20000)});
}
