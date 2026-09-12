
import { BlobClient, type BlobLeaseClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { safeLogger } from './safe-logger.js';

export interface LeaseTransport {
  acquireLease(duration:number,options?:{abortSignal:AbortSignal}):Promise<unknown>;
  renewLease(options?:{abortSignal:AbortSignal}):Promise<unknown>;
  releaseLease(options?:{abortSignal:AbortSignal}):Promise<unknown>;
}

/** Fail closed on any uncertain renewal, before the 60-second lease can expire. */
export class AzureApplicationLease {
  private timer:ReturnType<typeof setTimeout>|null=null;
  private pending:Promise<void>|null=null;
  private lost=false;
  private stopped=false;
  private constructor(private readonly lease:LeaseTransport,private readonly onLost:()=>void|Promise<void>) {}
  static async acquire(lease:LeaseTransport,onLost:()=>void|Promise<void>):Promise<AzureApplicationLease>{
    await lease.acquireLease(60,{abortSignal:AbortSignal.timeout(10000)});
    const owner=new AzureApplicationLease(lease,onLost);owner.schedule();return owner;
  }
  static async forApplication(containerUrl:string,appId:string,onLost:()=>void|Promise<void>):Promise<AzureApplicationLease>{
    const url=new URL(containerUrl);
    if(url.protocol!=='https:'||url.search||!/^\d+$/.test(appId))throw new Error('Invalid private lease container URL or application ID');
    const blob=new BlobClient(containerUrl.replace(/\/$/,'')+'/'+appId+'.lock',new DefaultAzureCredential(),
      {retryOptions:{maxTries:1}});
    // The lock blob must be provisioned once; do not overwrite another lease owner's object.
    const lease:BlobLeaseClient=blob.getBlobLeaseClient();
    return this.acquire(lease,onLost);
  }
  private schedule():void{
    if(this.stopped||this.lost)return;
    this.timer=setTimeout(()=>{
      this.pending=this.renew().finally(()=>{this.pending=null;this.schedule();});
    },15000);this.timer.unref();
  }
  public async renew():Promise<void>{
    if(this.stopped||this.lost)return;
    try{await this.lease.renewLease({abortSignal:AbortSignal.timeout(8000)});}
    catch(error){this.lost=true;safeLogger.error('Production lease lost; disconnecting Discord',error);await this.onLost();}
  }
  public async stop():Promise<void>{
    this.stopped=true;if(this.timer)clearTimeout(this.timer);
    // onLost must not await a stop path that waits for this same renewal.
    await this.pending;
    if(!this.lost)await this.lease.releaseLease({abortSignal:AbortSignal.timeout(5000)});
  }
}
