export type CheckStatus = 'pending' | 'success' | 'unavailable' | 'failed';

export interface CheckState {
  readonly discordUserId: string;
  readonly lastStartedAt: string | null;
  readonly lastCompletedAt: string | null;
  readonly lastStatus: CheckStatus | null;
  readonly lastErrorCode: string | null;
  readonly nextScheduledAt: string | null;
}
