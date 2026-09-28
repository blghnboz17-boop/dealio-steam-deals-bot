import { afterEach, describe, expect, it, vi } from 'vitest';
import { WishlistViewService } from '../src/application/wishlist-view-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';
import { SteamWishlistError } from '../src/domain/steam.js';

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
function fixture() {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
  const db=createDatabase(':memory:'),users=new UserConfigRepository(db),assistant=new AssistantRepository(db);
  const config=users.upsert('u','76561198000000000','en','US',new Date().toISOString());
  users.upsert('v','76561198000000001','en','US',new Date().toISOString());
  const reader={getWishlistWithErrors:vi.fn().mockResolvedValue({items:[],errors:[]})};
  const coordinator=new UserOperationCoordinator();
  const service=new WishlistViewService(users,reader,undefined,undefined,coordinator,assistant);
  return {db,users,assistant,config,reader,coordinator,service};
}
describe('shared wishlist refresh admission',()=>{
  it('coalesces 20 panels before they can add work to the user queue',async()=>{
    const f=fixture();const gate=Promise.withResolvers<void>();
    const busy=f.coordinator.runExclusive('u',()=>gate.promise);
    try {
      const requests=Array.from({length:20},()=>f.service.load('u','en',true));
      gate.resolve();await busy;
      const results=await Promise.all(requests);
      expect(f.reader.getWishlistWithErrors).toHaveBeenCalledTimes(1);
      expect(results.every(r=>r.status==='success')).toBe(true);
    }finally{gate.resolve();await busy;f.db.close();}
  });
  it('keeps cached reads immediate, isolates users, and admits a refresh at 30 seconds',async()=>{
    const f=fixture();try{
      await f.service.load('u','en',true);
      expect(await f.service.load('u','en',true)).toMatchObject({status:'cooldown',retryAfterSeconds:30});
      expect(await f.service.load('u','en')).toMatchObject({status:'success'});
      expect(await f.service.load('v','en',true)).toMatchObject({status:'success'});
      await vi.advanceTimersByTimeAsync(29_001);
      expect(await f.service.load('u','en',true)).toMatchObject({status:'cooldown',retryAfterSeconds:1});
      await vi.advanceTimersByTimeAsync(999);
      expect(await f.service.load('u','en',true)).toMatchObject({status:'success'});
      expect(f.reader.getWishlistWithErrors).toHaveBeenCalledTimes(3);
    }finally{f.db.close();}
  });
  it.each([new SteamWishlistError('STEAM_TIMEOUT','timeout'),new Error('unexpected failure')])('throttles retries after failed cold loads',async error=>{
    const f=fixture();try{
      f.reader.getWishlistWithErrors.mockRejectedValueOnce(error);
      await f.service.load('u','en').catch(()=>undefined);
      expect(await f.service.load('u','en')).toMatchObject({status:'cooldown'});
      expect(await f.service.load('u','en',true)).toMatchObject({status:'cooldown'});
      expect(f.reader.getWishlistWithErrors).toHaveBeenCalledTimes(1);
    }finally{f.db.close();}
  });
  it('starts cooldown after completion rather than admitting queued scans during a long request',async()=>{
    const f=fixture();const gate=Promise.withResolvers<{items:[];errors:[]}>();
    f.reader.getWishlistWithErrors.mockReturnValueOnce(gate.promise);
    try{
      const first=f.service.load('u','en',true);
      await vi.advanceTimersByTimeAsync(60_000);
      const second=f.service.load('u','en',true);
      gate.resolve({items:[],errors:[]});await Promise.all([first,second]);
      expect(f.reader.getWishlistWithErrors).toHaveBeenCalledTimes(1);
      expect(await f.service.load('u','en',true)).toMatchObject({status:'cooldown',retryAfterSeconds:30});
    }finally{gate.resolve({items:[],errors:[]});f.db.close();}
  });
  it('does not share an old account result or enqueue more work after a configuration change',async()=>{
    const f=fixture();const gate=Promise.withResolvers<void>();
    const busy=f.coordinator.runExclusive('u',()=>gate.promise);
    try{
      const first=f.service.load('u','en',true);
      f.users.upsert('u','76561198000000002','en','TR',new Date().toISOString());
      const second=f.service.load('u','en',true);
      // A different configuration must get an immediate response, not join the pending result.
      expect(await second).toMatchObject({status:'cooldown'});
      gate.resolve();await busy;await first;
      expect(f.reader.getWishlistWithErrors).not.toHaveBeenCalled();
    }finally{gate.resolve();await busy;f.db.close();}
  });
});
