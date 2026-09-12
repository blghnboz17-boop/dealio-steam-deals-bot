
import type { UserConfig } from '../domain/user-config.js';
import type { UserConfigRepository } from '../persistence/user-config-repository.js';
import type { AssistantRepository, GameRule } from '../persistence/assistant-repository.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { UserOperationCoordinator } from './user-operation-coordinator.js';
export class AssistantService {
  constructor(public readonly repository: AssistantRepository, private readonly users: UserConfigRepository,
    private readonly coordinator: UserOperationCoordinator,
    private readonly sendTest?: (config:UserConfig)=>Promise<void>) {}
  config(user:string) { return this.users.findByDiscordUserId(user); }
  async rule(user:string,identity:string,appId:number,rule:Omit<GameRule,'revision'>):Promise<void> {
    await this.coordinator.runExclusive(user,()=>{
      const config=this.config(user);
      if(!config || config.configurationId!==identity) throw new Error('Account changed. Reopen /wishlist.');
      const snapshot=this.repository.snapshot(config);
      const item=snapshot?.items.find(i=>i.appId===appId);
      if(!item) throw new Error('Game is no longer in the saved wishlist.');
      if(rule.mode==='target' && (!item.price?.currency || item.price.currency!==rule.currency))
        throw new Error('Price currency changed. Refresh the wishlist first.');
      this.repository.saveRule(config,appId,rule);
    });
  }
  async retryDm(user:string,identity:string):Promise<void>{
    await this.coordinator.runExclusive(user,async()=>{
      const config=this.config(user);
      if(!config||config.configurationId!==identity||!this.sendTest)throw new Error('Account changed');
      await this.sendTest(config);
    });
  }
  async preference(user:string,identity:string,p:NotificationPreference):Promise<void> {
    await this.coordinator.runExclusive(user,()=>{
      if(this.config(user)?.configurationId!==identity) throw new Error('Account changed. Reopen /dealio.');
      this.repository.savePreference(user,p);
    });
  }
}
