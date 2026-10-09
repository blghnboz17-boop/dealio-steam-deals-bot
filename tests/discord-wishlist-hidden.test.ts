import { describe, expect, it } from 'vitest';
import type { StatusDashboardResult } from '../src/application/status-service.js';
import type { CheckState } from '../src/domain/check-state.js';
import { buildHomePanel } from '../src/discord/home-view.js';
import { buildStatusV2Panel } from '../src/discord/status-view-v2.js';

type Ready = Extract<StatusDashboardResult, { status: 'ready' }>;
const at = '2026-10-09T19:00:00Z';

function ready(language: 'tr' | 'en', lastErrorCode: string | null): Ready {
  const checkState: CheckState = {
    discordUserId: 'owner', lastStartedAt: at, lastCompletedAt: at, lastStatus: 'unavailable', lastErrorCode,
    nextScheduledAt: at, lastSuccessCompletedAt: '2026-10-01T00:00:00Z', lastSuccessCheckedCount: 22,
    lastSuccessOnSaleCount: 3, lastSuccessFreeCount: 0, lastSuccessUnknownPriceCount: 0, lastSuccessFailedItemCount: 0,
  };
  return {
    status: 'ready', language,
    config: {
      discordUserId: 'owner', configurationId: 'config', steamId64: '76561198000000000',
      configVersion: 1, language, storeCountryCode: 'TR', enabled: true,
      minimumDiscountPercent: 20, dmOptInAt: at, dmDeliveryBlockedAt: null, createdAt: at, updatedAt: at,
    },
    checkState, notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
    latestPriceCurrencies: ['TRY'], gameDiscountOverrideCount: 0,
  } as Ready;
}

const text = (value: unknown) => JSON.stringify(value);

describe('a wishlist Steam will not show', () => {
  it('names the privacy fix on Home and in Settings instead of blaming Steam', () => {
    const home = text(buildHomePanel(ready('tr', 'STEAM_WISHLIST_INACCESSIBLE'), 'session', {}).toJSON());
    expect(home).toContain('İstek listeni göremiyorum');
    expect(home).toContain('https://steamcommunity.com/my/edit/settings');
    expect(home).not.toContain('Son kontrol yarım kaldı');

    const settings = text(buildStatusV2Panel(ready('en', 'STEAM_WISHLIST_INACCESSIBLE'), 'session', { mode: 'status' }).toJSON());
    expect(settings).toContain('Your wishlist looks private');
    expect(settings).toContain('I can’t see your wishlist');
    expect(settings).not.toContain('Couldn’t reach Steam');
    expect(settings).not.toContain('The last check didn’t finish');
  });

  it('keeps the Steam outage wording for other unavailable checks', () => {
    const home = text(buildHomePanel(ready('tr', 'STEAM_TIMEOUT'), 'session', {}).toJSON());
    expect(home).toContain('Son kontrol yarım kaldı');
    expect(home).not.toContain('İstek listeni göremiyorum');

    const settings = text(buildStatusV2Panel(ready('en', 'STEAM_TIMEOUT'), 'session', { mode: 'status' }).toJSON());
    expect(settings).toContain('Couldn’t reach Steam');
    expect(settings).not.toContain('looks private');
  });
});
