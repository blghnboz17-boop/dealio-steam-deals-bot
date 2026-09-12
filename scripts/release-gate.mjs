
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const path=process.argv[2];if(!path)throw new Error('Provide a completed release evidence JSON file');
const evidence=JSON.parse(await readFile(path,'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(evidence.commit!==head)throw new Error('Acceptance evidence must match this exact commit');
for(const gate of ['testBotDesktop','testBotMobile','restoreRehearsal','independentAlarm','cleanInstall','azureCreditVerified'])
 if(evidence[gate]?.passed!==true||!evidence[gate]?.evidence)throw new Error('Release gate missing: '+gate);
for(const key of ['termsUrl','privacyUrl']){
 const url=new URL(evidence[key]);if(url.protocol!=='https:')throw new Error('Legal page must use HTTPS');
 const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok||!(response.headers.get('content-type')??'').includes('text/html'))throw new Error('Legal page is unavailable: '+key);
}
console.log('Release evidence and legal links verified for '+head);
