/** The lowest price one store has offered for a game in one region, from an external price history. */
export interface HistoricalLow {
  readonly currency: string;
  readonly amountMinor: number;
  readonly discountPercent: number;
  readonly recordedAt: string;
}

export type HistoricalLowStanding = 'new-low' | 'matches-low' | 'above-low';

/**
 * Compares a confirmed Steam price with its recorded low. Different currencies are
 * never compared or converted; the history is then simply not shown.
 */
export function historicalLowStanding(
  finalPriceMinor: number,
  currency: string,
  low: HistoricalLow,
): HistoricalLowStanding | null {
  if (low.currency !== currency) {
    return null;
  }
  if (finalPriceMinor < low.amountMinor) {
    return 'new-low';
  }
  return finalPriceMinor === low.amountMinor ? 'matches-low' : 'above-low';
}
