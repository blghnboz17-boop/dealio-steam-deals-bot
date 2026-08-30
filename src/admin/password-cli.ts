import { emitKeypressEvents, type Key } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { createPasswordVerifier } from './password.js';

type InteractiveInput = NodeJS.ReadableStream & {
  readonly isTTY: true;
  setRawMode(enabled: boolean): void;
};

class PasswordInputError extends Error {
  public readonly name = 'PasswordInputError';
}

function isInteractiveInput(input: NodeJS.ReadableStream): input is InteractiveInput {
  return 'isTTY' in input && input.isTTY === true &&
    'setRawMode' in input && typeof input.setRawMode === 'function';
}

function readInteractivePassword(
  input: InteractiveInput,
  output: NodeJS.WritableStream,
): Promise<string> {
  emitKeypressEvents(input);
  output.write('Admin password (typing is hidden): ');
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = (): void => {
      input.removeListener('keypress', onKeypress);
      input.removeListener('error', onError);
      input.removeListener('end', onEnd);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onEnd = (): void => {
      cleanup();
      reject(new PasswordInputError('Password input ended before Enter was pressed.'));
    };
    const onKeypress = (character: string | undefined, key: Key): void => {
      if (key.ctrl === true && key.name === 'c') {
        cleanup();
        reject(new PasswordInputError('Password entry cancelled.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(password);
        return;
      }
      if (key.name === 'backspace') {
        password = [...password].slice(0, -1).join('');
        return;
      }
      if (character !== undefined && key.ctrl !== true && key.meta !== true) {
        password += character;
      }
    };

    input.on('keypress', onKeypress);
    input.once('error', onError);
    input.once('end', onEnd);
  });
}

async function readPipedPassword(input: NodeJS.ReadableStream): Promise<string | null> {
  const lines = createInterface({ input, terminal: false });
  const iterator = lines[Symbol.asyncIterator]();
  const first = await iterator.next();
  const second = await iterator.next();
  lines.close();
  return first.done || typeof first.value !== 'string' || !second.done ? null : first.value;
}

export async function runPasswordCli(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> {
  if (arguments_.length > 0) {
    output.write('Password must be provided through standard input, not command arguments.\n');
    return 2;
  }
  try {
    const interactive = isInteractiveInput(input);
    const password = interactive
      ? await readInteractivePassword(input, output)
      : await readPipedPassword(input);
    if (password === null) {
      output.write('Provide exactly one password line through standard input.\n');
      return 2;
    }
    const verifier = createPasswordVerifier(password);
    if (interactive) {
      output.write('Generated verifier (copy only the next line):\n');
    }
    output.write(`${verifier}\n`);
    return 0;
  } catch (error: unknown) {
    if (error instanceof Error) {
      output.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await runPasswordCli();
}
