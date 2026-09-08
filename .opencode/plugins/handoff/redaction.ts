import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

export const MAX_PERSISTED_TEXT_LENGTH = 500;

const SECRET_FIELD = '(?:DISCORD_TOKEN|DISCORD_CLIENT_ID|STEAM_WEB_API_KEY|ADMIN_USERS_JSON|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*)';
const SECRET_ASSIGNMENT_PATTERN = new RegExp(`\\b${SECRET_FIELD}\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)`, 'gi');
const SECRET_ASSIGNMENT_TEST_PATTERN = new RegExp(`\\b${SECRET_FIELD}\\s*[:=]`, 'i');
const SECRET_VALUE_PATTERN = /\b(?:secret-[a-z0-9-]{8,}|bearer\s+[a-z0-9._~-]{12,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|\d{17,20})\b/gi;
const SECRET_VALUE_TEST_PATTERN = /\b(?:secret-[a-z0-9-]{8,}|bearer\s+[a-z0-9._~-]{12,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|\d{17,20})\b/i;
const PATH_TOKEN_CHARACTER_PATTERN = /[A-Za-z0-9._~+\/-]/;
const WORD_PATTERN = /[a-z]+/g;
const CONTROL_VERBS: ReadonlySet<string> = new Set(['bypass', 'disregard', 'forget', 'ignore', 'override']);
const SCOPE_WORDS: ReadonlySet<string> = new Set([
  'above',
  'developer',
  'earlier',
  'original',
  'preceding',
  'previous',
  'previously',
  'prior',
  'system',
]);
const INSTRUCTION_NOUNS: ReadonlySet<string> = new Set([
  'directive',
  'directives',
  'guidance',
  'instruction',
  'instructions',
  'message',
  'messages',
  'prompt',
  'prompts',
  'rule',
  'rules',
]);
const PRIVILEGED_ACTORS: ReadonlySet<string> = new Set(['developer', 'system']);
const PROMPT_NOUNS: ReadonlySet<string> = new Set(['message', 'messages', 'prompt', 'prompts']);
const DISCLOSURE_VERBS: ReadonlySet<string> = new Set(['expose', 'reveal', 'show']);
const SENSITIVE_NOUNS: ReadonlySet<string> = new Set(['chain', 'prompt', 'reasoning']);
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._@+(), /-]+$/;
const SENSITIVE_SEGMENT_PATTERN = /^(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|passwords?(?:\..*)?|private[-_.]?keys?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:key|pem|p12|pfx))$/i;

export type RedactedText = {
  readonly value: string;
  readonly redactedValues: number;
  readonly truncatedValues: number;
};

export const containsSensitiveValue = (value: string): boolean =>
  SECRET_ASSIGNMENT_TEST_PATTERN.test(value) || SECRET_VALUE_TEST_PATTERN.test(value);

const isTokenBoundary = (value: string, index: number): boolean =>
  index === 0 || !PATH_TOKEN_CHARACTER_PATTERN.test(value[index - 1] ?? '');

const hasAbsolutePathToken = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!isTokenBoundary(value, index)) {
      continue;
    }

    const current = value[index];
    const next = value[index + 1];
    const afterNext = value[index + 2];
    if (current === '/' && next !== '/') {
      return true;
    }
    if (current === '~' && next === '/') {
      return true;
    }
    if (current === '\\' && next === '\\') {
      return true;
    }
    if (
      current !== undefined
      && /[A-Za-z]/.test(current)
      && next === ':'
      && (afterNext === '/' || afterNext === '\\')
    ) {
      return true;
    }
  }
  return false;
};

const hasInstructionControlPhrase = (value: string): boolean => {
  const words = value.toLowerCase().match(WORD_PATTERN) ?? [];
  for (const [index, word] of words.entries()) {
    const trailingWords = words.slice(index + 1, index + 9);
    const instructionIndex = trailingWords.findIndex((candidate) => INSTRUCTION_NOUNS.has(candidate));
    if (
      CONTROL_VERBS.has(word)
      && instructionIndex >= 0
      && trailingWords.slice(0, instructionIndex).some((candidate) => SCOPE_WORDS.has(candidate))
    ) {
      return true;
    }
    if (PRIVILEGED_ACTORS.has(word) && PROMPT_NOUNS.has(words[index + 1] ?? '')) {
      return true;
    }
    if (DISCLOSURE_VERBS.has(word) && trailingWords.some((candidate) => SENSITIVE_NOUNS.has(candidate))) {
      return true;
    }
    if (
      word === 'follow'
      && trailingWords.includes('new')
      && trailingWords.some((candidate) => INSTRUCTION_NOUNS.has(candidate))
      && trailingWords.includes('instead')
    ) {
      return true;
    }
  }
  return false;
};

export const redactText = (value: string): RedactedText => {
  let redactedValues = 0;
  const normalizedInput = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(SECRET_ASSIGNMENT_PATTERN, () => {
      redactedValues += 1;
      return '[redacted]';
    })
    .replace(SECRET_VALUE_PATTERN, () => {
      redactedValues += 1;
      return '[redacted]';
    })
    .replace(/\s+/g, ' ')
    .trim();
  const unsafeProse = hasAbsolutePathToken(normalizedInput)
    || hasInstructionControlPhrase(normalizedInput);
  const normalized = unsafeProse ? '[redacted]' : normalizedInput;
  if (unsafeProse) redactedValues += 1;
  const truncatedValues = normalized.length > MAX_PERSISTED_TEXT_LENGTH ? 1 : 0;

  return {
    value: normalized.slice(0, MAX_PERSISTED_TEXT_LENGTH),
    redactedValues,
    truncatedValues,
  };
};

export const isSensitivePath = (candidate: string): boolean =>
  candidate.split('/').some((segment) => SENSITIVE_SEGMENT_PATTERN.test(segment));

export const isSafeRelativePath = (candidate: string): boolean => {
  if (
    candidate.length === 0
    || candidate.length > 300
    || candidate.includes('\0')
    || candidate.includes('\\')
    || isAbsolute(candidate)
    || /^[A-Za-z]:/.test(candidate)
    || !SAFE_PATH_PATTERN.test(candidate)
  ) {
    return false;
  }

  const normalized = candidate.replaceAll(sep, '/');
  const segments = normalized.split('/');
  return posix.normalize(normalized) === normalized
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && !isSensitivePath(normalized)
    && !containsSensitiveValue(normalized)
    && redactText(normalized).value === normalized;
};

export type BoundedPaths = {
  readonly paths: readonly string[];
  readonly rejected: number;
  readonly truncated: number;
};

export function boundSafeRelativePaths(candidates: readonly string[], maximum = 200): BoundedPaths {
  const paths: string[] = [];
  let rejected = 0;
  let truncated = 0;
  for (const candidate of candidates) {
    if (!isSafeRelativePath(candidate)) {
      rejected += 1;
      continue;
    }
    if (paths.includes(candidate)) continue;
    const insertion = paths.findIndex((current) => current.localeCompare(candidate) > 0);
    const index = insertion < 0 ? paths.length : insertion;
    if (paths.length < maximum) paths.splice(index, 0, candidate);
    else if (index < maximum) {
      paths.splice(index, 0, candidate);
      paths.pop();
      truncated += 1;
    } else truncated += 1;
  }
  return { paths, rejected, truncated };
}

export const sanitizeRelativePath = (
  canonicalRoot: string,
  candidate: string,
): string | null => {
  if (
    !isAbsolute(canonicalRoot)
    || canonicalRoot.includes('\0')
    || candidate.includes('\0')
    || candidate.includes('\\')
    || /^[A-Za-z]:/.test(candidate)
  ) {
    return null;
  }

  const root = resolve(canonicalRoot);
  const absoluteCandidate = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const relativeCandidate = relative(root, absoluteCandidate).replaceAll(sep, '/');

  return isSafeRelativePath(relativeCandidate) ? relativeCandidate : null;
};
