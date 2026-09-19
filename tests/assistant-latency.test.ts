import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';
import type { AssistantService } from '../src/application/assistant-service.js';
import type { WishlistViewService, WishlistViewResult } from '../src/application/wishlist-view-service.js';
import { handleAssistant } from '../src/discord/commands/assistant.js';

function fixture(count=50) {
  const db = createDatabase(':memory:');
  const users = new UserConfigRepository(db);
  const config = users.upsert('u', '76561198000000000', 'en', 'US', new Date().toISOString());
  const repository = new AssistantRepository(db);
  const items = Array.from({ length: count }, (_, i) => ({ appId: i + 1, name: `Game ${i}`, priority: 1,
    dateAdded: null, onSale: false, price: null }));
  const result = { status: 'success', items, capturedAt: new Date().toISOString() } as WishlistViewResult;
  const load = vi.fn().mockResolvedValue(result);
  const collector = Object.assign(new EventEmitter(), { ended: false, stop() {
    this.ended = true; this.emit('end');
  } });
  const message = { createMessageComponentCollector: () => collector };
  const interaction = { id: 'latency-panel', user: { id: 'u' }, locale: 'en-US',
    deferReply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(message),
    followUp: vi.fn().mockResolvedValue(undefined) };
  const service = { config: () => users.findByDiscordUserId('u'), repository } as unknown as AssistantService;
  const click = (action: string) => {
    const component = { customId: `assistant:latency-panel:${action}`, user: { id: 'u' },
      deferUpdate: vi.fn().mockResolvedValue(undefined), isStringSelectMenu: () => false };
    collector.emit('collect', component); return component;
  };
  return { db, users, config, repository, load, result, collector, interaction, click,
    start: (screen: 'wishlist' | 'history' | 'rhythm' = 'wishlist') => handleAssistant(
      interaction as unknown as ChatInputCommandInteraction, service,
      { load } as unknown as WishlistViewService, undefined, screen) };
}

describe('assistant latency isolation', () => {
  it.each(['history', 'rhythm'] as const)('opens %s without a Steam request or cached wishlist', async screen => {
    const f = fixture(); const task = f.start(screen);
    try {
      await vi.waitFor(() => expect(f.interaction.editReply).toHaveBeenCalled());
      expect(f.load).not.toHaveBeenCalled();
    } finally { f.collector.stop(); await task; f.db.close(); }
  });

  it.each([2,50])('keeps navigation responsive with %i games and coalesces refresh clicks while Steam is pending', async count => {
    const f = fixture(count); const task = f.start();
    let finish!: (value: WishlistViewResult) => void;
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const refresh = f.click('refresh');
      await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2));
      f.click('refresh');
      const navigation = f.click('history');
      await vi.waitFor(() => expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Your alert history'));
      expect(refresh.deferUpdate).toHaveBeenCalledOnce();
      expect(navigation.deferUpdate).toHaveBeenCalledOnce();
      expect(f.load).toHaveBeenCalledTimes(2);
      finish(f.result);
      await new Promise(resolve => setImmediate(resolve));
      expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Your alert history');
    } finally { finish?.(f.result); f.collector.stop(); await task; f.db.close(); }
  });

  it('loads wishlist lazily after opening settings and can navigate away during that load', async () => {
    const f=fixture();const task=f.start('rhythm');
    let finish!: (value: WishlistViewResult)=>void;
    try {
      await vi.waitFor(()=>expect(f.collector.listenerCount('collect')).toBe(1));
      f.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
      f.click('wishlist');
      await vi.waitFor(()=>expect(f.load).toHaveBeenCalledWith('u','en',false));
      f.click('history');
      await vi.waitFor(()=>expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Your alert history'));
      f.click('wishlist');
      await vi.waitFor(()=>expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Refreshing from Steam'));
      expect(f.load).toHaveBeenCalledOnce();finish(f.result);
      await vi.waitFor(()=>expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Game 0'));
    } finally {finish?.(f.result);f.collector.stop();await task;f.db.close();}
  });

  it('recovers from a rejected refresh and permits retry without losing the saved list', async () => {
    const f=fixture();const task=f.start();
    try {
      await vi.waitFor(()=>expect(f.collector.listenerCount('collect')).toBe(1));
      f.load.mockRejectedValueOnce(new Error('offline'));f.click('refresh');
      await vi.waitFor(()=>expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Steam refresh failed'));
      expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).toContain('Game 0');
      f.click('refresh');await vi.waitFor(()=>expect(f.load).toHaveBeenCalledTimes(3));
    } finally {f.collector.stop();await task;f.db.close();}
  });

  it('does not publish a late refresh into an ended panel', async () => {
    const f=fixture();const task=f.start();
    let finish!: (value: WishlistViewResult)=>void;
    try {
      await vi.waitFor(()=>expect(f.collector.listenerCount('collect')).toBe(1));
      f.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.click('refresh');
      await vi.waitFor(()=>expect(f.load).toHaveBeenCalledTimes(2));
      f.collector.stop();const count=f.interaction.editReply.mock.calls.length;
      finish({...f.result,items:[{appId:99,name:'Late result',priority:1,dateAdded:null,onSale:false,price:null}]} as WishlistViewResult);
      await task;
      expect(f.interaction.editReply.mock.calls.length).toBe(count+1);
      expect(JSON.stringify(f.interaction.editReply.mock.calls.at(-1))).not.toContain('Late result');
    } finally {finish?.(f.result);f.collector.stop();await task;f.db.close();}
  });

  it('refuses to render refreshed data after the account configuration changes', async () => {
    const f=fixture();const task=f.start();
    let finish!: (value: WishlistViewResult)=>void;
    try {
      await vi.waitFor(()=>expect(f.collector.listenerCount('collect')).toBe(1));
      f.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.click('refresh');
      await vi.waitFor(()=>expect(f.load).toHaveBeenCalledTimes(2));
      const count=f.interaction.editReply.mock.calls.length;
      f.users.upsert('u','76561198000000001','en','US',new Date().toISOString());finish(f.result);
      await vi.waitFor(()=>expect(f.interaction.followUp).toHaveBeenCalled());
      expect(f.interaction.editReply.mock.calls.length).toBe(count);
    } finally {finish?.(f.result);f.collector.stop();await task;f.db.close();}
  });

  it('bulk rule reads preserve values and isolate users and configuration versions', () => {
    const f=fixture();
    try {
      const other=f.users.upsert('other','76561198000000001','en','US',new Date().toISOString());
      const rule={mode:'target' as const,targetMinor:1999,currency:'USD',percent:null,muted:true};
      f.repository.saveRule(f.config,1,rule);f.repository.saveRule(other,2,rule);
      expect([...f.repository.rules(f.config)]).toEqual([[1,{...rule,revision:1}]]);
      expect(f.repository.rules({...f.config,configVersion:f.config.configVersion+1}).size).toBe(0);
    } finally {f.db.close();}
  });

  it('does not query one rule per game or fetch history on the wishlist screen', async () => {
    const f = fixture(); const rule = vi.spyOn(f.repository, 'rule');
    const history = vi.spyOn(f.repository, 'history'); const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.click('next');
      await vi.waitFor(() => expect(f.interaction.editReply).toHaveBeenCalledTimes(2));
      expect(rule).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
    } finally { f.collector.stop(); await task; f.db.close(); }
  });
});
