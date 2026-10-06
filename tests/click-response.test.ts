import type { MessageComponentInteraction } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClickResponse, clickAnswerWindowMs } from '../src/discord/ui/click-response.js';
import { PanelOperationQueue } from '../src/discord/ui/operation-queue.js';
import { handOffPanel } from '../src/discord/ui/tab-bar.js';

const panel = { components: [] };

function click(ageMs = 0) {
  const message = { id: 'panel-message' };
  return {
    createdTimestamp: Date.now() - ageMs,
    message,
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(message),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

const asComponent = (value: ReturnType<typeof click>) => value as unknown as MessageComponentInteraction;

afterEach(() => { vi.useRealTimers(); });

describe('ClickResponse', () => {
  it('answers a click with its panel edit in one call', async () => {
    const component = click();
    const fallback = vi.fn();
    const response = new ClickResponse(asComponent(component), 'test');

    await expect(response.edit(panel, fallback)).resolves.toBe(component.message);
    await response.defer();

    expect(component.update).toHaveBeenCalledExactlyOnceWith(panel);
    expect(component.deferUpdate).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('defers a click whose edit is late, then edits through the fallback', async () => {
    vi.useFakeTimers();
    const component = click();
    const fallback = vi.fn().mockResolvedValue('edited');
    const response = new ClickResponse(asComponent(component), 'test');

    await vi.advanceTimersByTimeAsync(clickAnswerWindowMs);
    expect(component.deferUpdate).toHaveBeenCalledOnce();
    await expect(response.edit(panel, fallback)).resolves.toBe('edited');
    expect(component.update).not.toHaveBeenCalled();
  });

  it('defers at once a click that reached the bot already old', async () => {
    vi.useFakeTimers();
    const component = click(clickAnswerWindowMs + 200);
    new ClickResponse(asComponent(component), 'test');
    await vi.advanceTimersByTimeAsync(0);
    expect(component.deferUpdate).toHaveBeenCalledOnce();
  });
});

describe('PanelOperationQueue.enqueueClick', () => {
  it('lets the first edit of the click answer it and sends later edits normally', async () => {
    const component = click();
    const queue = new PanelOperationQueue(vi.fn());
    const editReply = vi.fn().mockResolvedValue(undefined);

    await queue.enqueueClick(asComponent(component), 'test', async () => {
      await queue.edit(panel, editReply);
      await queue.edit(panel, editReply);
    });

    expect(component.update).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledOnce();
    expect(component.deferUpdate).not.toHaveBeenCalled();
    // Outside a click's work, edits are ordinary edits.
    await queue.edit(panel, editReply);
    expect(editReply).toHaveBeenCalledTimes(2);
  });

  it('acknowledges a click that edits nothing', async () => {
    const component = click();
    const queue = new PanelOperationQueue(vi.fn());
    await queue.enqueueClick(asComponent(component), 'test', async () => undefined);
    expect(component.deferUpdate).toHaveBeenCalledOnce();
    expect(component.update).not.toHaveBeenCalled();
  });

  it('acknowledges a failed click before the error notice', async () => {
    const component = click();
    const order: string[] = [];
    component.deferUpdate.mockImplementation(async () => { order.push('ack'); });
    const queue = new PanelOperationQueue(() => { order.push('notice'); });
    await queue.enqueueClick(asComponent(component), 'test', async () => { throw new Error('boom'); });
    expect(order).toEqual(['ack', 'notice']);
  });
});

describe('handOffPanel', () => {
  it('answers a tab click with the target screen itself', async () => {
    const component = click();
    const { editReply } = component;
    const navigate = vi.fn(async (_target: string, target: MessageComponentInteraction) => {
      const opened = await target.editReply(panel);
      await target.editReply(panel);
      expect(opened).toBe(component.message);
    });

    handOffPanel({ component: asComponent(component), target: 'games', navigate, stop: vi.fn(), settle: async () => undefined });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(editReply).toHaveBeenCalledOnce());

    expect(component.update).toHaveBeenCalledExactlyOnceWith(panel);
    expect(component.deferUpdate).not.toHaveBeenCalled();
  });

  it('acknowledges the click before a target that only follows up', async () => {
    const component = click();
    const { followUp } = component;
    const navigate = vi.fn(async (_target: string, target: MessageComponentInteraction) => {
      await target.followUp({ content: 'notice' });
    });

    handOffPanel({ component: asComponent(component), target: 'games', navigate, stop: vi.fn(), settle: async () => undefined });
    await vi.waitFor(() => expect(followUp).toHaveBeenCalledOnce());
    expect(component.deferUpdate).toHaveBeenCalledOnce();
    expect(component.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(followUp.mock.invocationCallOrder[0]!);
  });
});
