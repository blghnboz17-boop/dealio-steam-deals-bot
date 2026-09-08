import { createHash } from 'node:crypto';
import { containsSensitiveValue, isSensitivePath, redactText } from './redaction.js';

export const VERIFICATION_COMMAND_IDS = [
  'handoff-tests',
  'handoff-typecheck',
  'project-tests',
  'project-typecheck',
] as const;

export type VerificationCommandId = (typeof VERIFICATION_COMMAND_IDS)[number];

export const VERIFICATION_COMMAND_NAMES: Readonly<Record<VerificationCommandId, string>> = {
  'handoff-tests': 'npm run test:handoff',
  'handoff-typecheck': 'npm run typecheck:handoff',
  'project-tests': 'npm test',
  'project-typecheck': 'npm run typecheck',
};

export type Verification = {
  readonly command: VerificationCommandId;
  readonly exitCode: number;
};

const SAFE_IDENTIFIER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9._:@/-]{1,128}$/;
const VERIFICATION_COMMAND_SET: ReadonlySet<string> = new Set(VERIFICATION_COMMAND_IDS);

export function safeIdentifier(value: string): string {
  return SAFE_IDENTIFIER_PATTERN.test(value)
    && !containsSensitiveValue(value)
    && !isSensitivePath(value)
    && !value.includes('/')
    && !value.includes('\\')
    && redactText(value).value === value
    ? value
    : `id-${createHash('sha256').update(value).digest('hex')}`;
}

export const isCanonicalIdentifier = (value: string): boolean =>
  SAFE_IDENTIFIER_PATTERN.test(value) && safeIdentifier(value) === value;

export function safeBranch(value: string): string {
  if (value.length === 0) return value;
  const safe = value.length <= 256
    && /^[A-Za-z0-9._/-]+$/.test(value)
    && !containsSensitiveValue(value)
    && !isSensitivePath(value)
    && redactText(value).value === value;
  return safe ? value : safeIdentifier(value);
}

export const isCanonicalBranch = (value: string): boolean => safeBranch(value) === value;

export function safeVerification(value: {
  readonly command: string;
  readonly exitCode: number;
}): Verification | null {
  if (!VERIFICATION_COMMAND_SET.has(value.command)) return null;
  if (!Number.isSafeInteger(value.exitCode) || value.exitCode < 0) return null;
  const command = VERIFICATION_COMMAND_IDS.find((candidate) => candidate === value.command);
  return command === undefined ? null : { command, exitCode: value.exitCode };
}
