import { describe, expect, it } from 'vitest';
import { summarizeOperationalLogs } from '../scripts/metrics-report-core.mjs';

describe('operational metrics report', () => {
  it('summarizes acknowledgement deadlines, scans, and delivery latency without exposing raw logs', () => {
    const report = summarizeOperationalLogs([
      'private user 1234 did something',
      '[discord-metric] {"operation":"setup.ack","durationMs":40,"failed":false,"interactionAgeMs":500}',
      '[discord-metric] {"operation":"wishlist.button-ack","durationMs":200,"failed":true,"interactionAgeMs":3100}',
      'Run completed: users=2 completed=2 errors=1 durationMs=1250 checkedGames=30 steamItemErrors=2 unknownPrices=1 unavailable=1 dmSent=1 dmFailed=0.',
      '[notification-timing] candidateToDeliveryMs=60000 mode=immediate',
      '[notification-timing] candidateToDeliveryMs=7200000 mode=quiet',
      '[notification-timing] candidateToDeliveryMs=3600000 mode=digest',
      '[discord-metric] malformed',
    ]);
    expect(report).toEqual({
      acknowledgements: {
        count: 2, failed: 1, overThreeSeconds: 1,
        p95AgeMs: 3100, p95DurationMs: 200,
      },
      scans: {
        runs: 1, users: 2, completed: 2, errors: 1,
        checkedGames: 30, steamItemErrors: 2, unknownPrices: 1,
        unavailable: 1, dmSent: 1, dmFailed: 0, p95DurationMs: 1250,
      },
      deliveries: {
        count: 3, immediateCount: 1, quietCount: 1, digestCount: 1,
        p95CandidateToDeliveryMs: 7_200_000,
        p95ImmediateCandidateToDeliveryMs: 60_000,
      },
    });
    expect(JSON.stringify(report)).not.toContain('private user');
  });

  it('returns null percentiles when no usable samples exist', () => {
    const report = summarizeOperationalLogs(['unrelated line', '[discord-metric] {}']);
    expect(report.acknowledgements).toMatchObject({ count: 0, p95AgeMs: null });
    expect(report.scans).toMatchObject({ runs: 0, p95DurationMs: null });
    expect(report.deliveries).toMatchObject({
      count: 0, p95CandidateToDeliveryMs: null,
      p95ImmediateCandidateToDeliveryMs: null,
    });
  });
});
