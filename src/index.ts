import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBotProcess } from './application/bot-process.js';
import { startBot } from './application/start-bot.js';

export { startBot };

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMainModule) {
  runBotProcess();
}
