/**
 * The owner blocked this Discord account. Only /delete-data stays available; the
 * services refuse everything else whatever the entry point, not only the Discord layer.
 */
export class AccountBlockedError extends Error {
  public readonly name = 'AccountBlockedError';

  public constructor() {
    super('This Discord account is blocked from using Dealio');
  }
}

export type BlockedAccountCheck = (discordUserId: string) => boolean;

export function assertAccountNotBlocked(
  isBlocked: BlockedAccountCheck | undefined,
  discordUserId: string,
): void {
  if (isBlocked?.(discordUserId) === true) {
    throw new AccountBlockedError();
  }
}
