import { EventEmitter } from 'node:events';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleSetup } from '../src/discord/commands/setup.js';

class SetupCollectorFake extends EventEmitter {
  public stop(reason?: string): void {
    this.emit('end', [], reason);
  }
}

describe('guided setup command', () => {
  it('defers ephemerally before checking for an existing configuration', async () => {
    // Given: a guided setup interaction and a service whose call order is observable.
    const collector = new SetupCollectorFake();
    const invocationOrder: string[] = [];
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'setup-session',
      locale: 'en-US',
      user: { id: 'discord-user' },
      client: { user: null },
      options: { getString: vi.fn().mockReturnValue(null) },
      deferReply: vi.fn((options: { flags: MessageFlags }) => {
        invocationOrder.push('deferReply');
        expect(options).toEqual({ flags: MessageFlags.Ephemeral });
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    };
    const service = {
      hasExistingConfiguration: vi.fn(() => {
        invocationOrder.push('hasExistingConfiguration');
        return false;
      }),
      prepare: vi.fn(),
      confirm: vi.fn(),
      configure: vi.fn(),
    };

    // When: the setup command starts.
    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
    collector.emit('end', [], 'time');
    await handling;

    // Then: acknowledgement is sent ephemerally before the configuration lookup.
    expect(invocationOrder).toEqual(['deferReply', 'hasExistingConfiguration']);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it('opens a new modal immediately after the user closes the previous modal', async () => {
    const collector = new SetupCollectorFake();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'setup-session',
      locale: 'tr',
      user: { id: 'discord-user' },
      client: { user: null },
      options: { getString: vi.fn().mockReturnValue(null) },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
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
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
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
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const rangeComponent = {
      customId: 'country:setup-session:range',
      user: { id: 'discord-user' },
      values: ['0'],
      isStringSelectMenu: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const countryComponent = {
      customId: 'country:setup-session:select',
      user: { id: 'discord-user' },
      values: ['DE'],
      isStringSelectMenu: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };

    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    collector.emit('collect', startComponent);
    await vi.waitFor(() => expect(service.prepare).toHaveBeenCalledOnce());
    collector.emit('collect', regionComponent);
    await vi.waitFor(() => expect(regionComponent.deferUpdate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('country:setup-session:range'));
    collector.emit('collect', rangeComponent);
    await vi.waitFor(() => expect(rangeComponent.deferUpdate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('country:setup-session:select'));
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

  it('drains delayed region-picker work without mutating after setup closes', async () => {
    // Given: a prepared setup whose region-picker acknowledgement is delayed.
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'en-US');
    const prepared = {
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'en' as const,
      storeCountryCode: 'US' as const,
    };
    const service = {
      ...setupService(),
      prepare: vi.fn().mockResolvedValue(prepared),
    };
    const profileModal = {
      customId: 'setup-modal:setup-session:discord-user:1',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('76561198000000000'),
        getStringSelectValues: vi.fn().mockReturnValue(['US']),
      },
    };
    let releaseRegionPicker: () => void = () => undefined;
    const regionPickerPending = new Promise<void>((resolve) => {
      releaseRegionPicker = resolve;
    });
    let handlingSettled = false;
    let responseMutationAfterHandling = false;
    const regionComponent = {
      customId: 'setup:setup-session:region',
      user: { id: 'discord-user' },
      isButton: () => true,
      deferUpdate: vi.fn().mockReturnValue(regionPickerPending),
      update: vi.fn(async () => {
        await regionPickerPending;
        if (handlingSettled) {
          responseMutationAfterHandling = true;
        }
      }),
    };

    // When: the collector closes before the region acknowledgement finishes.
    const handling = handleSetup(interaction as never, service as never);
    void handling.then(() => {
      handlingSettled = true;
    });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    collector.emit('collect', setupStartComponent(profileModal));
    await vi.waitFor(() => expect(service.prepare).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('setup:setup-session:region'));
    collector.emit('collect', regionComponent);
    const acknowledgedImmediately = regionComponent.deferUpdate.mock.calls.length === 1;
    collector.emit('end', [], 'time');
    for (let index = 0; index < 30; index += 1) {
      await Promise.resolve();
    }
    const settledBeforeRegionPicker = handlingSettled;
    releaseRegionPicker();
    await handling;
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }

    // Then: the handler drains the region task and no response mutation occurs after return.
    expect(acknowledgedImmediately).toBe(true);
    expect(settledBeforeRegionPicker).toBe(false);
    expect(responseMutationAfterHandling).toBe(false);
    expect(regionComponent.update).not.toHaveBeenCalled();
  });

  it.each([
    ['range', 'country:setup-session:range'],
    ['back', 'country:setup-session:back'],
  ] as const)('reports a rejected country %s acknowledgement through the setup boundary', async (
    kind,
    customId,
  ) => {
    // Given: an active setup whose country navigation acknowledgement will be rejected.
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'en-US');
    const updateError = new Error(`country ${kind} acknowledgement rejected`);
    const deferUpdate = vi.fn().mockRejectedValue(updateError);
    const component = kind === 'range'
      ? {
          customId,
          user: { id: 'discord-user' },
          values: ['0'],
          isStringSelectMenu: () => true,
          deferUpdate,
        }
      : {
          customId,
          user: { id: 'discord-user' },
          isButton: () => true,
          deferUpdate,
        };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // When: the collector dispatches the navigation interaction and then closes.
      const handling = handleSetup(interaction as never, setupService() as never);
      await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
      collector.emit('collect', component);
      collector.emit('end', [], 'time');
      await handling;

      // Then: the rejection reaches the setup error/reporting boundary.
      expect(errorLog).toHaveBeenCalledWith('Discord setup wizard failed', updateError);
      expect(interaction.editReply).toHaveBeenCalledTimes(3);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('drains earlier work when a country navigation acknowledgement rejects', async () => {
    // Given: a pending parent update followed by navigation whose immediate acknowledgement rejects.
    const collector = new SetupCollectorFake();
    let handlingSettled = false;
    let parentMutationAfterHandling = false;
    const interaction = setupInteraction(collector, 'en-US');
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    interaction.editReply.mockImplementation(async () => {
      if (handlingSettled) {
        parentMutationAfterHandling = true;
      }
      return { createMessageComponentCollector };
    });
    let releaseEarlierOperation: () => void = () => undefined;
    const earlierOperation = new Promise<void>((resolve) => {
      releaseEarlierOperation = resolve;
    });
    const queuedComponent = {
      customId: 'setup:setup-session:how',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockReturnValue(earlierOperation),
    };
    const acknowledgementError = new Error('country range acknowledgement rejected');
    const navigationComponent = {
      customId: 'country:setup-session:range',
      user: { id: 'discord-user' },
      values: ['0'],
      isStringSelectMenu: () => true,
      deferUpdate: vi.fn().mockRejectedValue(acknowledgementError),
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // When: the collector closes before the pending predecessor is released.
      const handling = handleSetup(interaction as never, setupService() as never);
      void handling.then(() => {
        handlingSettled = true;
      });
      await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
      collector.emit('collect', queuedComponent);
      await vi.waitFor(() => expect(queuedComponent.deferUpdate).toHaveBeenCalledOnce());
      collector.emit('collect', navigationComponent);
      expect(navigationComponent.deferUpdate).toHaveBeenCalledOnce();
      collector.emit('end', [], 'time');
      for (let index = 0; index < 30; index += 1) {
        await Promise.resolve();
      }
      const settledBeforeDrain = handlingSettled;
      releaseEarlierOperation();
      await handling;
      for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
      }

      // Then: shutdown drains the predecessor and reports the acknowledgement rejection once.
      expect(settledBeforeDrain).toBe(false);
      expect(parentMutationAfterHandling).toBe(false);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        'Discord setup wizard failed',
        acknowledgementError,
      );
    } finally {
      releaseEarlierOperation();
      errorLog.mockRestore();
    }
  });

  it.each([
    ['range', 'country:setup-session:range', 'country:setup-session:select'],
    ['back', 'country:setup-session:back', 'country:setup-session:range'],
  ] as const)('acknowledges country %s navigation before earlier queued work completes', async (
    kind,
    customId,
    expectedPanelAction,
  ) => {
    // Given: setup parent updates are blocked behind an earlier queued interaction.
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'en-US');
    let releaseEarlierOperation: () => void = () => undefined;
    const earlierOperation = new Promise<void>((resolve) => {
      releaseEarlierOperation = resolve;
    });
    const queuedComponent = {
      customId: 'setup:setup-session:how',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockReturnValue(earlierOperation),
    };
    const navigationComponent = kind === 'range'
      ? {
          customId,
          user: { id: 'discord-user' },
          values: ['0'],
          isStringSelectMenu: () => true,
          deferUpdate: vi.fn().mockResolvedValue(undefined),
        }
      : {
          customId,
          user: { id: 'discord-user' },
          isButton: () => true,
          deferUpdate: vi.fn().mockResolvedValue(undefined),
        };

    // When: navigation arrives while the earlier operation still owns the parent-update queue.
    const handling = handleSetup(interaction as never, setupService() as never);
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    collector.emit('collect', queuedComponent);
    await vi.waitFor(() => expect(queuedComponent.deferUpdate).toHaveBeenCalledOnce());
    collector.emit('collect', navigationComponent);

    // Then: Discord is acknowledged immediately, while the parent panel remains serialized.
    const acknowledgedImmediately = navigationComponent.deferUpdate.mock.calls.length === 1;
    const parentReplyCountWhileQueued = interaction.editReply.mock.calls.length;
    releaseEarlierOperation();
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledTimes(3));
    const finalQueuedPanel = JSON.stringify(interaction.editReply.mock.calls[2]?.[0]);
    collector.emit('end', [], 'time');
    await handling;
    expect(acknowledgedImmediately).toBe(true);
    expect(parentReplyCountWhileQueued).toBe(1);
    expect(finalQueuedPanel).toContain(expectedPanelAction);
  });

  it('drains delayed country preparation without mutating a closed setup session', async () => {
    // Given: initial country selection is waiting on delayed Steam preparation.
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'en-US');
    let finishPreparation: (prepared: object) => void = () => undefined;
    const preparation = new Promise<object>((resolve) => {
      finishPreparation = resolve;
    });
    const service = {
      ...setupService(),
      prepare: vi.fn().mockReturnValue(preparation),
    };
    const modal = {
      customId: 'setup-modal:setup-session:discord-user:1',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('76561198000000000'),
        getStringSelectValues: vi.fn().mockReturnValue(['OTHER']),
      },
    };
    const countryComponent = {
      customId: 'country:setup-session:select',
      user: { id: 'discord-user' },
      values: ['DE'],
      isStringSelectMenu: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };

    // When: the collector closes while service preparation remains in flight.
    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    collector.emit('collect', setupStartComponent(modal));
    await vi.waitFor(() => expect(JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('country:setup-session:range'));
    collector.emit('collect', countryComponent);
    await vi.waitFor(() => expect(service.prepare).toHaveBeenCalledOnce());
    collector.emit('end', [], 'time');
    let handlingSettled = false;
    void handling.then(() => {
      handlingSettled = true;
    });
    for (let index = 0; index < 6; index += 1) {
      await Promise.resolve();
    }

    // Then: the handler drains the operation and ignores its result after session closure.
    const settledBeforePreparation = handlingSettled;
    finishPreparation({
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'en',
      storeCountryCode: 'DE',
    });
    await handling;
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }
    expect(settledBeforePreparation).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledTimes(4);
    const finalPanel = JSON.stringify(interaction.editReply.mock.calls.at(-1)?.[0]);
    expect(finalPanel).toContain('setup:setup-session:start');
    expect(finalPanel).not.toContain('setup:setup-session:confirm');
  });

  it('ignores a modal submission that completes after its setup collector closes', async () => {
    // Given: a modal opened by an active setup but submitted only after collector expiry.
    const collector = new SetupCollectorFake();
    const interaction = setupInteraction(collector, 'en-US');
    const service = setupService();
    let submitModal: (modal: unknown) => void = () => undefined;
    const modalSubmission = new Promise<unknown>((resolve) => {
      submitModal = resolve;
    });
    const component = setupStartComponent();
    component.awaitModalSubmit.mockReturnValue(modalSubmission);
    const modal = {
      customId: 'setup-modal:setup-session:discord-user:1',
      user: { id: 'discord-user' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('76561198000000000'),
        getStringSelectValues: vi.fn().mockReturnValue(['US']),
      },
    };

    // When: the collector closes before the pending modal submission resolves.
    const handling = handleSetup(interaction as never, service as never);
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledOnce());
    collector.emit('collect', component);
    await vi.waitFor(() => expect(component.awaitModalSubmit).toHaveBeenCalledOnce());
    collector.emit('end', [], 'time');
    await handling;
    const closedReplyCount = interaction.editReply.mock.calls.length;
    submitModal(modal);
    await Promise.resolve();
    await Promise.resolve();

    // Then: late modal work cannot prepare configuration or replace the expired response.
    expect(modal.deferUpdate).not.toHaveBeenCalled();
    expect(service.prepare).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(closedReplyCount);
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
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
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

function setupService() {
  return {
    hasExistingConfiguration: vi.fn().mockReturnValue(false),
    prepare: vi.fn(),
    confirm: vi.fn(),
    configure: vi.fn(),
  };
}
