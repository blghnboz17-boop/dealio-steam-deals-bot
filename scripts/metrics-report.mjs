import { summarizeOperationalLogs } from './metrics-report-core.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
console.log(JSON.stringify(summarizeOperationalLogs(input.split(/\r?\n/)), null, 2));
