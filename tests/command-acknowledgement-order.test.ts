import { EventEmitter } from 'node:events';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleCheck } from '../src/discord/commands/check.js';
import { handleDealio } from '../src/discord/commands/dealio.js';
import { handleDeleteData } from '../src/discord/commands/delete-data.js';
import { handleStatus } from '../src/discord/commands/status.js';

class EndingCollector extends EventEmitter {
  public stop(reason: string): void {
    this.emit('end', new Map(), reason);
  }
}

function expectAcknowledgedBefore(
  acknowledgement: ReturnType<typeof vi.fn>,
  serviceRead: ReturnType<typeof vi.fn>,
): void {
  expect(acknowledgement).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(acknowledgement.mock.invocationCallOrder[0]).toBeLessThan(
    serviceRead.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
  );
}

function collectorMessage() {
  const collector = new EndingCollector();
  return {
    createMessageComponentCollector: vi.fn().mockImplementation(() => {
      queueMicrotask(() => collector.emit('end', new Map(), 'test'));
      return collector;
    }),
  };
}

describe('Discord command acknowledgement order', () => {
  it('acknowledges /dealio before reading dashboard state', async () => {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const getDashboard = vi.fn().mockReturnValue({ status: 'not-configured', language: 'en' });
    const message = collectorMessage();
    const interaction = {
      id: 'dealio-session',
      user: { id: 'owner' },
      locale: 'en-US',
      client: { user: null },
      deferReply,
      reply: vi.fn().mockResolvedValue(message),
      editReply: vi.fn().mockResolvedValue(message),
    };

    await handleDealio(interaction as never, { statusService: { getDashboard } } as never);

    expectAcknowledgedBefore(deferReply, getDashboard);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('acknowledges /status before reading dashboard state', async () => {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const getDashboard = vi.fn().mockReturnValue({ status: 'not-configured', language: 'en' });
    const interaction = {
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply,
      reply: vi.fn(),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleStatus(interaction as never, { getDashboard } as never, {} as never);

    expectAcknowledgedBefore(deferReply, getDashboard);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('acknowledges /check before reading configuration state', async () => {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockReturnValue({ config: null });
    const interaction = {
      user: { id: 'owner' },
      deferReply,
      reply: vi.fn(),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleCheck(
      interaction as never,
      { check: vi.fn() } as never,
      { get } as never,
      { deliverPending: vi.fn() } as never,
    );

    expectAcknowledgedBefore(deferReply, get);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('acknowledges /delete-data before reading configuration state', async () => {
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockReturnValue(null);
    const message = collectorMessage();
    const interaction = {
      id: 'delete-session',
      user: { id: 'owner' },
      locale: 'en-US',
      deferReply,
      reply: vi.fn().mockResolvedValue(message),
      editReply: vi.fn().mockResolvedValue(message),
    };

    await handleDeleteData(interaction as never, { get } as never);

    expectAcknowledgedBefore(deferReply, get);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
