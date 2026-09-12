
import {it,expect,vi} from 'vitest';
import {SteamClient} from '../src/steam/steam-client.js';
function fixture(){
 let now=Date.parse('2026-09-12T00:00:00Z'),fail=false;
 const fetch=vi.fn(async(url:string)=>{
  if(url.includes('GetWishlist'))return new Response(JSON.stringify({response:{items:[{appid:10,priority:1,date_added:0}]}}),{headers:{'x-eresult':'1'}});
  if(fail)return new Response('{}',{status:503});
  return new Response(JSON.stringify({'10':{success:true,data:{steam_appid:10,name:'Game',is_free:false,price_overview:{currency:'USD',initial:1000,final:500,discount_percent:50}}}}));
 });
 const client=new SteamClient({fetchImpl:fetch,now:()=>now,maxRetries:0});
 return {client,fetch,advance:()=>{now+=300001;},fail:()=>{fail=true;},recover:()=>{fail=false;}};
}
it('coalesces simultaneous users by app/country/language and preserves price observation time',async()=>{
 const f=fixture();
 const [one,two]=await Promise.all([f.client.getWishlist('76561198000000000','TR','en'),f.client.getWishlist('76561198000000001','TR','en')]);
 expect(f.fetch.mock.calls.filter(([url])=>url.includes('appdetails'))).toHaveLength(1);
 expect(one[0].priceObservedAt).toBe(two[0].priceObservedAt);
 await f.client.getWishlist('76561198000000000','TR','tr');
 await f.client.getWishlist('76561198000000000','US','en');
 expect(f.fetch.mock.calls.filter(([url])=>url.includes('appdetails'))).toHaveLength(3);
 f.advance();const renewed=await f.client.getWishlist('76561198000000000','TR','en');
 expect(renewed[0].priceObservedAt).not.toBe(one[0].priceObservedAt);
});
it('does not cache failures or reuse an expired price on a failed refresh',async()=>{
 const f=fixture();await f.client.getWishlist('76561198000000000','TR','en');f.advance();f.fail();
 const failed=await f.client.getWishlistWithErrors('76561198000000000','TR','en');
 expect(failed.items).toHaveLength(0);expect(failed.errors).toHaveLength(1);
 f.recover();expect((await f.client.getWishlist('76561198000000000','TR','en'))).toHaveLength(1);
});
