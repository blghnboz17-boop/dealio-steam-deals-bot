
import type { UserConfig } from '../domain/user-config.js';
import type { UserConfigRepository } from '../persistence/user-config-repository.js';
import type { AssistantRepository, GameRule } from '../persistence/assistant-repository.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { UserOperationCoordinator } from './user-operation-coordinator.js';
import type { GameHistorySource } from '../price-history/itad-client.js';
import { assertAccountNotBlocked, type BlockedAccountCheck } from './account-block.js';
export class AssistantService {
  constructor(public readonly repository: AssistantRepository, private readonly users: UserConfigRepository,
    private readonly coordinator: UserOperationCoordinator,
    private readonly sendTest?: (config:UserConfig)=>Promise<void>,
    public readonly priceHistory?: GameHistorySource,
    /** The configured check interval, shown to users as it really is. */
    public readonly pollIntervalHours?: number,
    /** Accounts the owner blocked cannot change rules, alert timing or send test alerts. */
    private readonly isBlocked?: BlockedAccountCheck) {}
  config(user:string) { return this.users.findByDiscordUserId(user); }
  async rule(user:string,identity:string,appId:number,rule:Omit<GameRule,'revision'>,version:number):Promise<void> {
    await this.coordinator.runExclusive(user,()=>{
      assertAccountNotBlocked(this.isBlocked,user);
      const config=this.config(user);
      if(!config || config.configurationId!==identity || config.configVersion!==version) throw new Error('Account changed. Reopen /dealio.');
      const snapshot=this.repository.snapshot(config);
      const item=snapshot?.items.find(i=>i.appId===appId);
      if(!item) throw new Error('Game is no longer in the saved wishlist.');
      if(rule.mode==='target' && (!item.price?.currency || item.price.currency!==rule.currency))
        throw new Error('Price currency changed. Refresh the wishlist first.');
      this.repository.saveRule(config,appId,rule);
    });
  }
  async retryDm(user:string,identity:string,version:number):Promise<void>{
    await this.coordinator.runExclusive(user,async()=>{
      assertAccountNotBlocked(this.isBlocked,user);
      const config=this.config(user);
      if(!config||config.configurationId!==identity||config.configVersion!==version||!this.sendTest)throw new Error('Account changed');
      await this.sendTest(config);
    });
  }
  async preference(user:string,identity:string,p:NotificationPreference,version:number):Promise<void> {
    await this.coordinator.runExclusive(user,()=>{
      assertAccountNotBlocked(this.isBlocked,user);
      const config=this.config(user);
      if(!config||config.configurationId!==identity||config.configVersion!==version) throw new Error('Account changed. Reopen /dealio.');
      this.repository.savePreference(user,p);
    });
  }
}
