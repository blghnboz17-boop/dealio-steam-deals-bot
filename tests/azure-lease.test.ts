
import {it,expect,vi} from 'vitest';
import {AzureApplicationLease} from '../src/application/azure-lease.js';
it('rejects a second process when Azure holds the application lease',async()=>{
 const transport={acquireLease:vi.fn().mockRejectedValue(new Error('LeaseAlreadyPresent')),renewLease:vi.fn(),releaseLease:vi.fn()};
 await expect(AzureApplicationLease.acquire(transport,vi.fn())).rejects.toThrow('LeaseAlreadyPresent');
});
it('disconnects on the first uncertain renewal and does not release an unowned lease',async()=>{
 const transport={acquireLease:vi.fn().mockResolvedValue({}),renewLease:vi.fn().mockRejectedValue(new Error('Network unavailable')),releaseLease:vi.fn()};
 const lost=vi.fn(),lease=await AzureApplicationLease.acquire(transport,lost);
 await lease.renew();await lease.renew();expect(lost).toHaveBeenCalledTimes(1);
 await lease.stop();expect(transport.releaseLease).not.toHaveBeenCalled();
});
it('releases on an orderly stop',async()=>{
 const transport={acquireLease:vi.fn().mockResolvedValue({}),renewLease:vi.fn(),releaseLease:vi.fn().mockResolvedValue({})};
 const lease=await AzureApplicationLease.acquire(transport,vi.fn());await lease.stop();
 expect(transport.acquireLease).toHaveBeenCalledWith(60,expect.any(Object));
 expect(transport.releaseLease).toHaveBeenCalledTimes(1);
});
