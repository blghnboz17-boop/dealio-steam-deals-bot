import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleDealio } from '../src/discord/commands/dealio.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { dealioUiSessions } from '../src/discord/ui/session-manager.js';

const dashboard = {
  status: 'ready', language: 'en',
  config: {
    discordUserId: 'owner', configurationId: 'config', configVersion: 1,
    steamId64: '76561198000000000', storeCountryCode: 'US', language: 'en',
    enabled: true, minimumDiscountPercent: 20, dmDeliveryBlockedAt: null,
  },
  checkState: null, notificationQueue: { pending: 0, retry: 0, sent: 0, terminalFailed: 0 },
  latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
};
class Collector extends EventEmitter {
  stop(reason: string) { this.emit('end', new Map(), reason); }
}
function fixture() {
  const collector = new Collector();
  const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
  const interaction = {
    id: 'recovery-session', user: { id: 'owner' }, locale: 'en-US', client: { user: null },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const statusService = { getDashboard: vi.fn().mockReturnValue(dashboard) };
  return { collector, createMessageComponentCollector, interaction, statusService };
}
function click(prefix: string, action: string) {
  return {
    customId: prefix + ':recovery-session:' + action, user: { id: 'owner' },
    isButton: () => true, isStringSelectMenu: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
  };
}
describe('dashboard recovery', () => {
  it.each(['dealio', 'status-v2'])('%s remains usable after a transient update failure', async (kind) => {
    const f = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const setEnabled = vi.fn().mockRejectedValueOnce(new Error('database busy')).mockResolvedValue(null);
    const handling = kind === 'dealio'
      ? handleDealio(f.interaction as never, { statusService: f.statusService } as never)
      : handleStatus(f.interaction as never, f.statusService as never, { setEnabled } as never);
    try {
      await vi.waitFor(() => expect(f.createMessageComponentCollector).toHaveBeenCalledOnce());
      if (kind === 'dealio') f.interaction.editReply.mockRejectedValueOnce(new Error('Discord unavailable'));
      f.collector.emit('collect', click(kind, kind === 'dealio' ? 'refresh' : 'disable'));
      await vi.waitFor(() => expect(f.interaction.followUp).toHaveBeenCalledOnce());
      f.collector.emit('collect', click(kind, kind === 'dealio' ? 'refresh' : 'disable'));
      await vi.waitFor(() => expect(f.interaction.editReply.mock.calls.length).toBeGreaterThanOrEqual(kind === 'dealio' ? 3 : 2));
    } finally {
      f.collector.stop('time');
      await handling;
      log.mockRestore();
    }
    expect(dealioUiSessions.resolve(kind + ':recovery-session:refresh', 'owner')).toBe('expired');
  });

  it.each(['dealio', 'status-v2'])('%s closes if shutdown occurred while the first panel loaded', async (kind) => {
    const f = fixture();
    const lifecycle = new AbortController();
    lifecycle.abort();
    const handling = kind === 'dealio'
      ? handleDealio(f.interaction as never, { statusService: f.statusService, lifecycleSignal: lifecycle.signal } as never)
      : handleStatus(f.interaction as never, f.statusService as never, {} as never, lifecycle.signal);
    await handling;
    expect(f.interaction.editReply).toHaveBeenCalledTimes(2);
    expect(dealioUiSessions.resolve(kind + ':recovery-session:refresh', 'owner')).toBe('expired');
  });

  it('reports a dashboard outage without telling users their setup was deleted', async () => {
    const f = fixture();
    const handling = handleDealio(f.interaction as never, { statusService: f.statusService } as never);
    await vi.waitFor(() => expect(f.createMessageComponentCollector).toHaveBeenCalledOnce());
    f.statusService.getDashboard.mockReturnValue({ status: 'unavailable', language: 'en' } as never);
    f.collector.emit('collect', click('dealio', 'refresh'));
    await vi.waitFor(() => expect(f.interaction.editReply).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(f.interaction.editReply.mock.calls[1]?.[0])).toContain('Couldn’t load your details');
    f.collector.stop('time');
    await handling;
  });
});
