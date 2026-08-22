import { EventEmitter } from 'node:events';
import { ButtonStyle } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleStatus, parseDiscountPercent } from '../src/discord/commands/status.js';

class FakeCollector extends EventEmitter {
  public readonly stopReasons: string[] = [];

  public stop(reason: string): void {
    this.stopReasons.push(reason);
    this.emit('end', new Map(), reason);
  }
}

function dashboard(enabled: boolean) {
  return {
    status: 'ready' as const,
    language: 'en' as const,
    config: {
      discordUserId: 'owner',
      configurationId: 'configuration-id',
      steamId64: '76561198000000000',
      configVersion: 1,
      language: 'en' as const,
      storeCountryCode: 'US' as const,
      enabled,
      minimumDiscountPercent: 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: enabled ? '2026-08-21T00:00:00.000Z' : '2026-08-21T01:00:00.000Z',
    },
    checkState: null,
    notificationQueue: {
      pending: 0,
      retry: 0,
      sending: 0,
      sent: 0,
      terminalFailed: 0,
      expired: 0,
    },
    latestPriceCurrencies: ['USD'],
    gameDiscountOverrideCount: 0,
  };
}

function interactionFixture(collector: FakeCollector) {
  const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
  return {
    interaction: {
      id: 'status-session',
      user: { id: 'owner' },
      locale: 'en-US',
      client: {
        user: {
          displayAvatarURL: vi.fn().mockReturnValue('https://cdn.example/bot-avatar.png'),
        },
      },
      reply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
      editReply: vi.fn().mockResolvedValue(undefined),
    },
    createMessageComponentCollector,
  };
}

describe('/status component session', () => {
  it('validates whole percentages', () => {
    expect(parseDiscountPercent('0')).toBe(0);
    expect(parseDiscountPercent('100')).toBe(100);
    expect(parseDiscountPercent('10.5')).toBeNull();
    expect(parseDiscountPercent('101')).toBeNull();
    expect(parseDiscountPercent('')).toBeNull();
  });

  it('allows only the owner session and refreshes the dashboard after disabling', async () => {
    const collector = new FakeCollector();
    const { interaction, createMessageComponentCollector } = interactionFixture(collector);
    const statusService = {
      getDashboard: vi.fn()
        .mockReturnValueOnce(dashboard(true))
        .mockReturnValueOnce(dashboard(false)),
    };
    const configurationService = {
      setEnabled: vi.fn().mockResolvedValue(dashboard(false).config),
    };

    const handling = handleStatus(
      interaction as never,
      statusService as never,
      configurationService as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
    const options = createMessageComponentCollector.mock.calls[0]?.[0];
    expect(options.filter({
      customId: 'status:status-session:disable', user: { id: 'other' },
    })).toBe(false);
    expect(options.filter({
      customId: 'status:old-session:disable', user: { id: 'owner' },
    })).toBe(false);
    expect(options.filter({
      customId: 'status:status-session:disable', user: { id: 'owner' },
    })).toBe(true);
    expect(interaction.reply.mock.calls[0]?.[0]).toMatchObject({
      embeds: [{ thumbnail: { url: 'https://cdn.example/bot-avatar.png' } }],
      components: [{ components: [
        {
          label: 'Disable notifications',
          style: ButtonStyle.Danger,
        },
        {
          label: 'Edit minimum discount',
          style: ButtonStyle.Secondary,
        },
      ] }],
    });
    expect(interaction.client.user.displayAvatarURL).toHaveBeenCalledWith({
      extension: 'png',
      size: 128,
    });

    collector.emit('collect', {
      customId: 'status:status-session:disable',
      user: { id: 'owner' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());

    expect(configurationService.setEnabled).toHaveBeenCalledWith('owner', false);
    expect(statusService.getDashboard).toHaveBeenCalledTimes(2);
    expect(interaction.editReply.mock.calls[0]?.[0]).toMatchObject({
      content: null,
      embeds: [{ color: 0x95a5a6 }],
      components: [{ components: [
        {
          custom_id: 'status:status-session:enable',
          label: 'Enable notifications',
          style: ButtonStyle.Success,
        },
        {
          custom_id: 'status:status-session:minimum-discount',
          label: 'Edit minimum discount',
          style: ButtonStyle.Secondary,
        },
      ] }],
    });

    collector.emit('end', new Map(), 'time');
    await handling;
    expect(interaction.editReply.mock.calls.at(-1)?.[0].components[0].components[0].disabled)
      .toBe(true);
  });

  it('stops and disables the current control during shutdown', async () => {
    const collector = new FakeCollector();
    const { interaction, createMessageComponentCollector } = interactionFixture(collector);
    const lifecycle = new AbortController();
    const handling = handleStatus(
      interaction as never,
      { getDashboard: vi.fn().mockReturnValue(dashboard(true)) } as never,
      { setEnabled: vi.fn() } as never,
      lifecycle.signal,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    lifecycle.abort();
    await handling;

    expect(collector.stopReasons).toContain('shutdown');
    expect(interaction.editReply.mock.calls.at(-1)?.[0].components[0].components[0].disabled)
      .toBe(true);
  });

  it('shows a localized safe error when the toggle fails', async () => {
    const collector = new FakeCollector();
    const { interaction, createMessageComponentCollector } = interactionFixture(collector);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handling = handleStatus(
      interaction as never,
      { getDashboard: vi.fn().mockReturnValue(dashboard(true)) } as never,
      { setEnabled: vi.fn().mockRejectedValue(new Error('database secret')) } as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    collector.emit('collect', {
      customId: 'status:status-session:disable',
      user: { id: 'owner' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    const payload = interaction.editReply.mock.calls[0]?.[0];
    expect(payload.content).toContain('could not be changed');
    expect(payload.content).not.toContain('database secret');

    collector.emit('end', new Map(), 'time');
    await handling;
    errorLog.mockRestore();
  });

  it('opens the global threshold modal without deferring the button and refreshes after submit', async () => {
    const collector = new FakeCollector();
    const { interaction, createMessageComponentCollector } = interactionFixture(collector);
    const updatedDashboard = dashboard(true);
    updatedDashboard.config.minimumDiscountPercent = 45;
    const statusService = {
      getDashboard: vi.fn()
        .mockReturnValueOnce(dashboard(true))
        .mockReturnValueOnce(updatedDashboard),
    };
    const thresholdService = { setGlobal: vi.fn().mockResolvedValue(updatedDashboard.config) };
    const modal = {
      customId: 'status-threshold:status-session:owner:1',
      user: { id: 'owner' },
      fields: { getTextInputValue: vi.fn().mockReturnValue('45') },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const component = {
      customId: 'status:status-session:minimum-discount',
      user: { id: 'owner' },
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockResolvedValue(modal),
      deferUpdate: vi.fn(),
    };
    const handling = handleStatus(
      interaction as never,
      statusService as never,
      { setEnabled: vi.fn() } as never,
      undefined,
      thresholdService as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    collector.emit('collect', component);
    await vi.waitFor(() => expect(thresholdService.setGlobal)
      .toHaveBeenCalledWith('owner', 45, 'configuration-id'));

    expect(component.deferUpdate).not.toHaveBeenCalled();
    expect(component.showModal.mock.calls[0]?.[0].toJSON()).toMatchObject({
      custom_id: 'status-threshold:status-session:owner:1',
      title: 'Global minimum discount',
    });
    expect(modal.deferUpdate).toHaveBeenCalledOnce();
    expect(interaction.editReply.mock.calls[0]?.[0].content).toContain('45%');
    collector.emit('end', new Map(), 'time');
    await handling;
  });

  it('cancels an active global threshold modal during shutdown without saving', async () => {
    const collector = new FakeCollector();
    const { interaction, createMessageComponentCollector } = interactionFixture(collector);
    const lifecycle = new AbortController();
    const thresholdService = { setGlobal: vi.fn() };
    const handling = handleStatus(
      interaction as never,
      { getDashboard: vi.fn().mockReturnValue(dashboard(true)) } as never,
      { setEnabled: vi.fn() } as never,
      lifecycle.signal,
      thresholdService as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
    const component = {
      customId: 'status:status-session:minimum-discount',
      user: { id: 'owner' },
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockReturnValue(new Promise(() => undefined)),
      deferUpdate: vi.fn(),
    };
    collector.emit('collect', component);
    await vi.waitFor(() => expect(component.awaitModalSubmit).toHaveBeenCalledOnce());

    lifecycle.abort();
    await handling;

    expect(thresholdService.setGlobal).not.toHaveBeenCalled();
  });
});
