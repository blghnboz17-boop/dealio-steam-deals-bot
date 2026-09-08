import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { handleWishlist } from '../src/discord/commands/wishlist.js';

class WishlistCollectorFake extends EventEmitter {}

type FallbackComponentFactory = (
  deferUpdate: ReturnType<typeof vi.fn>,
) => Readonly<Record<string, unknown>>;

const fallbackCases: ReadonlyArray<readonly [string, FallbackComponentFactory]> = [
  [
    'unavailable game threshold control',
    (deferUpdate) => ({
      customId: 'wishlist-v2:interaction-id:game',
      user: { id: 'invoking-user' },
      values: ['1'],
      isStringSelectMenu: () => true,
      isButton: () => false,
      deferUpdate,
    }),
  ],
  [
    'unsupported component control',
    (deferUpdate) => ({
      customId: 'wishlist-v2:interaction-id:unsupported',
      user: { id: 'invoking-user' },
      isStringSelectMenu: () => false,
      isButton: () => false,
      deferUpdate,
    }),
  ],
];

describe('/wishlist fallback acknowledgements', () => {
  it.each(fallbackCases)(
    'acknowledges and drains the %s without an unhandled rejection',
    async (_name, componentFor) => {
      // Given: the fallback acknowledgement remains pending when the collector ends.
      const collector = new WishlistCollectorFake();
      const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
      const interaction = {
        id: 'interaction-id',
        user: { id: 'invoking-user' },
        locale: 'en-US',
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
      };
      const service = {
        load: vi.fn().mockResolvedValue({
          status: 'success',
          language: 'en',
          items: [{
            appId: 1,
            name: 'Game 1',
            priority: null,
            dateAdded: null,
            price: null,
            onSale: false,
          }],
          errors: [],
          capturedAt: '2026-08-30T12:00:00.000Z',
          configVersion: 1,
          configurationId: 'configuration-id',
        }),
      };
      let rejectAcknowledgement: (reason: Error) => void = () => undefined;
      const acknowledgement = new Promise<void>((_resolve, reject) => {
        rejectAcknowledgement = reject;
      });
      const deferUpdate = vi.fn().mockReturnValue(acknowledgement);
      const unhandledReasons: unknown[] = [];
      const onUnhandledRejection = (reason: unknown): void => {
        unhandledReasons.push(reason);
      };
      const acknowledgementError = new Error('fallback acknowledgement rejected');
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      process.on('unhandledRejection', onUnhandledRejection);
      let handlingSettled = false;

      try {
        // When: the collector receives the fallback control and ends before acknowledgement settles.
        const handling = handleWishlist(interaction as never, service as never);
        void handling.then(() => {
          handlingSettled = true;
        });
        await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
        collector.emit('collect', componentFor(deferUpdate));
        const acknowledgedImmediately = deferUpdate.mock.calls.length === 1;
        collector.emit('end', new Map(), 'time');
        for (let index = 0; index < 30; index += 1) {
          await Promise.resolve();
        }
        const settledBeforeAcknowledgement = handlingSettled;
        rejectAcknowledgement(acknowledgementError);
        await handling;
        await new Promise<void>((resolve) => setImmediate(resolve));

        // Then: acknowledgement starts immediately, is contained, and is drained before return.
        expect(acknowledgedImmediately).toBe(true);
        expect(settledBeforeAcknowledgement).toBe(false);
        expect(unhandledReasons).toEqual([]);
        expect(errorLog).toHaveBeenCalledWith(
          'Discord wishlist fallback acknowledgement failed',
          acknowledgementError,
        );
      } finally {
        rejectAcknowledgement(acknowledgementError);
        process.off('unhandledRejection', onUnhandledRejection);
        errorLog.mockRestore();
      }
    },
  );
});
