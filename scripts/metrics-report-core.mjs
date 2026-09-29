function percentile95(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function nonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function summarizeOperationalLogs(lines) {
  const acknowledgementAges = [];
  const acknowledgementDurations = [];
  const scanDurations = [];
  const deliveryLatencies = [];
  const immediateDeliveryLatencies = [];
  const testDeliveryLatencies = [];
  const report = {
    testDeliveries: { count: 0, p95CandidateToDeliveryMs: null },
    acknowledgements: { count: 0, failed: 0, overThreeSeconds: 0, p95AgeMs: null, p95DurationMs: null },
    scans: {
      runs: 0, users: 0, completed: 0, errors: 0, checkedGames: 0,
      steamItemErrors: 0, unknownPrices: 0, unavailable: 0,
      dmSent: 0, dmFailed: 0, p95DurationMs: null,
    },
    deliveries: {
      count: 0, immediateCount: 0, quietCount: 0, digestCount: 0,
      p95CandidateToDeliveryMs: null,
      p95ImmediateCandidateToDeliveryMs: null,
    },
  };

  for (const line of lines) {
    const testDelivery = line.match(/\[test-notification-timing\] candidateToDeliveryMs=(\d+)/);
    if (testDelivery) {
      const latency = Number(testDelivery[1]);
      if (Number.isSafeInteger(latency)) {
        testDeliveryLatencies.push(latency);
        report.testDeliveries.count += 1;
      }
      continue;
    }
    const ackMarker = '[discord-metric] ';
    const ackIndex = line.indexOf(ackMarker);
    if (ackIndex >= 0) {
      try {
        const metric = JSON.parse(line.slice(ackIndex + ackMarker.length));
        if (typeof metric.operation === 'string'
          && typeof metric.failed === 'boolean'
          && nonnegativeNumber(metric.durationMs)) {
          report.acknowledgements.count += 1;
          report.acknowledgements.failed += Number(metric.failed);
          acknowledgementDurations.push(metric.durationMs);
          if (nonnegativeNumber(metric.interactionAgeMs)) {
            acknowledgementAges.push(metric.interactionAgeMs);
            report.acknowledgements.overThreeSeconds += Number(metric.interactionAgeMs >= 3000);
          }
        }
      } catch { /* Ignore incomplete or unrelated journal entries. */ }
      continue;
    }

    const scan = line.match(/Run completed: users=(\d+) completed=(\d+) errors=(\d+) durationMs=(\d+) checkedGames=(\d+) steamItemErrors=(\d+) unknownPrices=(\d+) unavailable=(\d+) dmSent=(\d+) dmFailed=(\d+)\./);
    if (scan) {
      const fields = [
        'users', 'completed', 'errors', 'durationMs', 'checkedGames',
        'steamItemErrors', 'unknownPrices', 'unavailable', 'dmSent', 'dmFailed',
      ];
      const values = scan.slice(1).map(Number);
      if (values.every(Number.isSafeInteger)) {
        report.scans.runs += 1;
        fields.forEach((field, index) => {
          if (field === 'durationMs') scanDurations.push(values[index]);
          else report.scans[field] += values[index];
        });
      }
      continue;
    }

    const delivery = line.match(/\[notification-timing\] candidateToDeliveryMs=(\d+) mode=(immediate|quiet|digest)/);
    if (delivery) {
      const latency = Number(delivery[1]);
      if (Number.isSafeInteger(latency)) {
        deliveryLatencies.push(latency);
        report.deliveries.count += 1;
        if (delivery[2] === 'digest') report.deliveries.digestCount += 1;
        else if (delivery[2] === 'quiet') report.deliveries.quietCount += 1;
        else {
          report.deliveries.immediateCount += 1;
          immediateDeliveryLatencies.push(latency);
        }
      }
    }
  }

  report.acknowledgements.p95AgeMs = percentile95(acknowledgementAges);
  report.acknowledgements.p95DurationMs = percentile95(acknowledgementDurations);
  report.scans.p95DurationMs = percentile95(scanDurations);
  report.deliveries.p95CandidateToDeliveryMs = percentile95(deliveryLatencies);
  report.deliveries.p95ImmediateCandidateToDeliveryMs = percentile95(immediateDeliveryLatencies);
  report.testDeliveries.p95CandidateToDeliveryMs = percentile95(testDeliveryLatencies);
  return report;
}
