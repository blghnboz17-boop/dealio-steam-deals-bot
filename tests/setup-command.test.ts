import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleSetup } from '../src/discord/commands/setup.js';

class SetupCollectorFake extends EventEmitter {
  public stop(reason?: string): void {
    this.emit('end', [], reason);
  }
}

describe('guided setup command', () => {
  it('opens a new modal immediately after the user closes the previous modal', async () => {
    const collector = new SetupCollectorFake();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'setup-session',
      locale: 'tr',
      user: { id: 'discord-user' },
      client: { user: null },
      options: { getString: vi.fn().mockReturnValue(null) },
      reply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      hasExistingConfiguration: vi.fn().mockReturnValue(false),
      prepare: vi.fn(),
      confirm: vi.fn(),
      configure: vi.fn(),
    };
    const firstComponent = setupStartComponent();
    const secondComponent = setupStartComponent();

    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    collector.emit('collect', firstComponent);
    await vi.waitFor(() => expect(firstComponent.showModal).toHaveBeenCalledOnce());
    collector.emit('collect', secondComponent);
    await vi.waitFor(() => expect(secondComponent.showModal).toHaveBeenCalledOnce());

    expect(firstComponent.awaitModalSubmit).toHaveBeenCalledOnce();
    expect(secondComponent.awaitModalSubmit).toHaveBeenCalledOnce();
    expect(service.prepare).not.toHaveBeenCalled();
    collector.emit('end', [], 'time');
    await handling;
  });

  it('shows the Steam profile and a preselected country list in one modal', async () => {
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'tr');
    const prepared = {
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'tr' as const,
      storeCountryCode: 'TR' as const,
    };
    const service = {
      hasExistingConfiguration: vi.fn().mockReturnValue(false),
      prepare: vi.fn().mockResolvedValue(prepared),
      confirm: vi.fn(),
      configure: vi.fn(),
    };
    const modal = {
      customId: 'setup-modal:setup-session:discord-user:1',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      fields: {
        getTextInputValue: vi.fn((name: string) => {
          if (name !== 'steam-profile') {
            throw new Error(`Unexpected setup field: ${name}`);
          }
          return '76561198000000000';
        }),
        getStringSelectValues: vi.fn().mockReturnValue(['TR']),
      },
    };
    const component = setupStartComponent(modal);

    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(interaction.reply).toHaveBeenCalledOnce());
    collector.emit('collect', component);
    await vi.waitFor(() => expect(service.prepare).toHaveBeenCalledOnce());

    const setupModal = component.showModal.mock.calls[0]?.[0].toJSON();
    expect(setupModal.components).toHaveLength(2);
    expect(setupModal.components[1]).toMatchObject({
      label: 'Steam Store ülkesi',
      component: {
        custom_id: 'store-country',
        placeholder: 'Steam Store ülkeni listeden seç',
      },
    });
    expect(setupModal.components[1].component.options).toContainEqual(expect.objectContaining({
      label: 'Türkiye (TR)',
      value: 'TR',
      default: true,
    }));
    expect(service.prepare).toHaveBeenCalledWith(
      'discord-user',
      '76561198000000000',
      'tr',
      'TR',
    );
    expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('Discord diline göre otomatik önerildi');
    collector.emit('end', [], 'time');
    await handling;
  });

  it('lets the user replace the suggested region through the complete country catalog', async () => {
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'tr');
    const prepared = {
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'tr' as const,
      storeCountryCode: 'TR' as const,
    };
    const service = {
      hasExistingConfiguration: vi.fn().mockReturnValue(false),
      prepare: vi.fn().mockResolvedValue(prepared),
      confirm: vi.fn(),
      configure: vi.fn(),
    };
    const profileModal = {
      customId: 'setup-modal:setup-session:discord-user:1',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('76561198000000000'),
        getStringSelectValues: vi.fn().mockReturnValue(['TR']),
      },
    };
    const startComponent = setupStartComponent(profileModal);
    const regionComponent = {
      customId: 'setup:setup-session:region',
      user: { id: 'discord-user' },
      isButton: () => true,
      update: vi.fn().mockResolvedValue(undefined),
    };
    const rangeComponent = {
      customId: 'country:setup-session:range',
      user: { id: 'discord-user' },
      values: ['0'],
      isStringSelectMenu: () => true,
      update: vi.fn().mockResolvedValue(undefined),
    };
    const countryComponent = {
      customId: 'country:setup-session:select',
      user: { id: 'discord-user' },
      values: ['DE'],
      isStringSelectMenu: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };

    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(interaction.reply).toHaveBeenCalledOnce());
    collector.emit('collect', startComponent);
    await vi.waitFor(() => expect(service.prepare).toHaveBeenCalledOnce());
    collector.emit('collect', regionComponent);
    await vi.waitFor(() => expect(regionComponent.update).toHaveBeenCalledOnce());
    expect(JSON.stringify(regionComponent.update.mock.calls[0]?.[0])).toContain('country:setup-session:range');
    collector.emit('collect', rangeComponent);
    await vi.waitFor(() => expect(rangeComponent.update).toHaveBeenCalledOnce());
    expect(JSON.stringify(rangeComponent.update.mock.calls[0]?.[0])).toContain('country:setup-session:select');
    collector.emit('collect', countryComponent);
    await vi.waitFor(() => expect(countryComponent.deferUpdate).toHaveBeenCalledOnce());

    await vi.waitFor(() => expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('Almanya (DE)'));
    expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('Senin seçtiğin mağaza bölgesi');
    expect(service.confirm).not.toHaveBeenCalled();
    collector.emit('end', [], 'time');
    await handling;
  });
});

function setupInteraction(collector: SetupCollectorFake, locale: string) {
  const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
  return {
    id: 'setup-session',
    locale,
    user: { id: 'discord-user' },
    client: { user: null },
    options: { getString: vi.fn().mockReturnValue(null) },
    reply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function setupStartComponent(modal?: unknown) {
  return {
    customId: 'setup:setup-session:start',
    user: { id: 'discord-user' },
    showModal: vi.fn().mockResolvedValue(undefined),
    awaitModalSubmit: modal === undefined
      ? vi.fn().mockReturnValue(new Promise(() => undefined))
      : vi.fn().mockResolvedValue(modal),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
  };
}
