import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleDeleteData } from '../src/discord/commands/delete-data.js';

class FakeCollector extends EventEmitter {
  public stop(reason: string): void {
    this.emit('end', new Map(), reason);
  }
}

describe('/delete-data modal operation lifecycle', () => {
  it('starts and drains a rejected cancel update', async () => {
    const collector = new FakeCollector();
    const acknowledgement = Promise.withResolvers<void>();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(message),
    };
    const component = {
      customId: 'delete-v2:delete-session:cancel',
      user: { id: 'owner' },
      update: vi.fn().mockReturnValue(acknowledgement.promise),
    };
    const rejection = new Error('cancel update failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let handlerSettled = false;

    try {
      const handling = handleDeleteData(
        interaction as never,
        { get: vi.fn().mockReturnValue({ language: 'en' }) } as never,
      );
      void handling.then(() => {
        handlerSettled = true;
      });
      await vi.waitFor(() => expect(message.createMessageComponentCollector).toHaveBeenCalledOnce());

      collector.emit('collect', component);

      expect(component.update).toHaveBeenCalledOnce();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handlerSettled).toBe(false);

      acknowledgement.reject(rejection);
      await handling;

      expect(handlerSettled).toBe(true);
      expect(errorLog).toHaveBeenCalledWith('Discord delete-data cancel failed', rejection);
    } finally {
      acknowledgement.resolve();
      errorLog.mockRestore();
    }
  });

  it('starts and drains a rejected fallback acknowledgement', async () => {
    const collector = new FakeCollector();
    const acknowledgement = Promise.withResolvers<void>();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(message),
    };
    const component = {
      customId: 'delete-v2:delete-session:unknown',
      user: { id: 'owner' },
      deferUpdate: vi.fn().mockReturnValue(acknowledgement.promise),
    };
    const rejection = new Error('fallback acknowledgement failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let handlerSettled = false;

    try {
      const handling = handleDeleteData(
        interaction as never,
        { get: vi.fn().mockReturnValue({ language: 'en' }) } as never,
      );
      void handling.then(() => {
        handlerSettled = true;
      });
      await vi.waitFor(() => expect(message.createMessageComponentCollector).toHaveBeenCalledOnce());

      collector.emit('collect', component);

      expect(component.deferUpdate).toHaveBeenCalledOnce();
      collector.stop('shutdown');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(handlerSettled).toBe(false);

      acknowledgement.reject(rejection);
      await handling;

      expect(handlerSettled).toBe(true);
      expect(errorLog).toHaveBeenCalledWith('Discord delete-data acknowledgement failed', rejection);
    } finally {
      acknowledgement.resolve();
      errorLog.mockRestore();
    }
  });

  it('settles when the collector stops before modal submission', async () => {
    const collector = new FakeCollector();
    const modalSubmission = Promise.withResolvers<never>();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(message),
    };
    const service = {
      get: vi.fn().mockReturnValue({ language: 'en' }),
      deleteData: vi.fn(),
    };
    const component = {
      customId: 'delete-v2:delete-session:confirm',
      user: { id: 'owner' },
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockReturnValue(modalSubmission.promise),
    };
    let handlerSettled = false;

    const handling = handleDeleteData(interaction as never, service as never);
    void handling.then(() => {
      handlerSettled = true;
    });
    await vi.waitFor(() => expect(message.createMessageComponentCollector).toHaveBeenCalledOnce());
    collector.emit('collect', component);
    await vi.waitFor(() => expect(component.awaitModalSubmit).toHaveBeenCalledOnce());

    collector.stop('shutdown');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(handlerSettled).toBe(true);
    expect(service.deleteData).not.toHaveBeenCalled();
    await handling;
  });

  it('drains deletion and its final response after the collector stops', async () => {
    const collector = new FakeCollector();
    const deletion = Promise.withResolvers<boolean>();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const finalResponse = Promise.withResolvers<typeof message>();
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn()
        .mockResolvedValueOnce(message)
        .mockReturnValueOnce(finalResponse.promise),
    };
    const service = {
      get: vi.fn().mockReturnValue({ language: 'en' }),
      deleteData: vi.fn().mockReturnValue(deletion.promise),
    };
    const modal = {
      customId: 'delete-confirm:delete-session:owner',
      user: { id: 'owner' },
      fields: { getCheckboxGroup: vi.fn().mockReturnValue(['confirmed']) },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    };
    const component = {
      customId: 'delete-v2:delete-session:confirm',
      user: { id: 'owner' },
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockResolvedValue(modal),
    };
    let handlerSettled = false;

    const handling = handleDeleteData(interaction as never, service as never);
    void handling.then(() => {
      handlerSettled = true;
    });
    await vi.waitFor(() => expect(message.createMessageComponentCollector).toHaveBeenCalledOnce());
    collector.emit('collect', component);
    await vi.waitFor(() => expect(service.deleteData).toHaveBeenCalledOnce());

    collector.stop('shutdown');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(handlerSettled).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledOnce();

    deletion.resolve(true);
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledTimes(2));
    expect(handlerSettled).toBe(false);

    finalResponse.resolve(message);
    await handling;

    expect(handlerSettled).toBe(true);
  });

  it('drains setup-again after the collector stops', async () => {
    const collector = new FakeCollector();
    const setupAcknowledgement = Promise.withResolvers<void>();
    const message = {
      createMessageComponentCollector: vi.fn().mockReturnValue(collector),
    };
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(message),
    };
    const setupComponent = {
      customId: 'delete-v2:delete-session:setup',
      id: 'setup-session',
      user: { id: 'owner' },
      locale: 'en-US',
      client: { user: null },
      options: { getString: vi.fn().mockReturnValue(null) },
      deferReply: vi.fn().mockReturnValue(setupAcknowledgement.promise),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const setupService = {
      hasExistingConfiguration: vi.fn().mockReturnValue(true),
      configure: vi.fn(),
      prepare: vi.fn(),
      confirm: vi.fn(),
    };
    let handlerSettled = false;

    const handling = handleDeleteData(
      interaction as never,
      { get: vi.fn().mockReturnValue({ language: 'en' }) } as never,
      setupService as never,
    );
    void handling.then(() => {
      handlerSettled = true;
    });
    await vi.waitFor(() => expect(message.createMessageComponentCollector).toHaveBeenCalledOnce());
    collector.emit('collect', setupComponent);
    await vi.waitFor(() => expect(setupComponent.deferReply).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(handlerSettled).toBe(false);

    setupAcknowledgement.resolve();
    await handling;

    expect(handlerSettled).toBe(true);
    expect(setupComponent.editReply).toHaveBeenCalledOnce();
  });
});
