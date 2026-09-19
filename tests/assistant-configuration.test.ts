import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../src/application/assistant-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';

describe('assistant panel configuration safety', () => {
  it('allows rule, timing and DM actions from the current panel', async () => {
    const db=createDatabase(':memory:');
    try {
      const users=new UserConfigRepository(db),repository=new AssistantRepository(db);
      const config=users.upsert('u','76561198000000000','en','US',new Date().toISOString());
      repository.saveSnapshot(config,{items:[{appId:1,name:'Game',priority:1,dateAdded:null,onSale:false,price:null}],errors:[]},new Date().toISOString());
      const send=vi.fn().mockResolvedValue(undefined);
      const service=new AssistantService(repository,users,new UserOperationCoordinator(),send);
      await service.rule('u',config.configurationId,1,{mode:'percent',percent:50,targetMinor:null,currency:null,muted:false},config.configVersion);
      await service.preference('u',config.configurationId,{mode:'digest',timezone:'UTC',digestMinute:600,quietStart:null,quietEnd:null},config.configVersion);
      await service.retryDm('u',config.configurationId,config.configVersion);
      expect(repository.rule(config,1)?.percent).toBe(50);
      expect(repository.preference('u').mode).toBe('digest');
      expect(send).toHaveBeenCalledOnce();
    } finally {db.close();}
  });
  it.each(['rule', 'preference', 'retry'] as const)('rejects queued %s from an old account or region', async action => {
    for (const change of ['account', 'region', 'recreate'] as const) {
      const db=createDatabase(':memory:');
      const users=new UserConfigRepository(db), repository=new AssistantRepository(db);
      const coordinator=new UserOperationCoordinator(), send=vi.fn().mockResolvedValue(undefined);
      const service=new AssistantService(repository,users,coordinator,send);
      const config=users.upsert('u','76561198000000000','en','US',new Date().toISOString());
      let release!:()=>void;
      const pending=coordinator.runExclusive('u',()=>new Promise<void>(resolve=>{release=resolve;}));
      await Promise.resolve();
      const rule={mode:'percent' as const,percent:50,targetMinor:null,currency:null,muted:false};
      const preference={mode:'digest' as const,timezone:'UTC',digestMinute:600,quietStart:null,quietEnd:null};
      const mutation=action==='rule'?service.rule('u',config.configurationId,1,rule,config.configVersion)
        :action==='preference'?service.preference('u',config.configurationId,preference,config.configVersion)
        :service.retryDm('u',config.configurationId,config.configVersion);
      const rejected=expect(mutation).rejects.toThrow('Account changed');
      try {
        if(change==='recreate')users.deleteByDiscordUserId('u');
        const current=users.upsert('u',change==='account'?'76561198000000001':config.steamId64,'en',
          change==='region'?'TR':'US',new Date().toISOString());
        repository.saveSnapshot(current,{items:[{appId:1,name:'Game',priority:1,dateAdded:null,onSale:false,price:null}],errors:[]},new Date().toISOString());
        release();await pending;await rejected;
        expect(repository.rule(current,1)).toBeNull();
        expect(repository.preference('u').mode).toBe('instant');
        expect(send).not.toHaveBeenCalled();
      } finally {release();await pending;db.close();}
    }
  });
});
