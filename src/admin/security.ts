const FORM_BODY_LIMIT_BYTES = 8 * 1024;

export const ADMIN_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
} as const;

export const ADMIN_COOKIE_NAMES = [
  '__Host-dealio_login',
  '__Host-dealio_admin',
] as const;
export type AdminCookieName = (typeof ADMIN_COOKIE_NAMES)[number];

export type PublicOrigin = {
  readonly origin: string;
  readonly host: string;
};

export class RequestValidationError extends Error {
  readonly name = 'RequestValidationError';
  readonly status = 400;

  constructor() {
    super('Invalid admin request');
  }
}

export type FormBodyErrorStatus = 400 | 413 | 415;

function formBodyErrorMessage(status: FormBodyErrorStatus): string {
  switch (status) {
    case 400:
      return 'Malformed form body';
    case 413:
      return 'Request body too large';
    case 415:
      return 'Unsupported media type';
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new RequestValidationError();
}

export class FormBodyError extends Error {
  readonly name = 'FormBodyError';

  constructor(readonly status: FormBodyErrorStatus) {
    super(formBodyErrorMessage(status));
  }
}

export function parsePublicOrigin(value: string | undefined): PublicOrigin {
  if (value === undefined || value === '') throw new RequestValidationError();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error: unknown) {
    if (error instanceof TypeError) throw new RequestValidationError();
    throw error;
  }
  const canonical = value === parsed.origin || value === `${parsed.origin}/`;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !canonical
  ) {
    throw new RequestValidationError();
  }
  return { origin: parsed.origin, host: parsed.host };
}

export function validateRequestAuthority(
  headers: Headers,
  publicOrigin: PublicOrigin,
  method: string,
): void {
  if (headers.get('host') !== publicOrigin.host) throw new RequestValidationError();
  if (method === 'POST' && headers.get('origin') !== publicOrigin.origin) {
    throw new RequestValidationError();
  }
}

export type AdminCookieOptions = {
  readonly name: AdminCookieName;
  readonly value: string;
  readonly maxAgeSeconds: number;
};

export function serializeAdminCookie(options: AdminCookieOptions): string {
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) {
    throw new RequestValidationError();
  }
  let encoded: string;
  try {
    encoded = encodeURIComponent(options.value);
  } catch (error: unknown) {
    if (error instanceof URIError) throw new RequestValidationError();
    throw error;
  }
  return `${options.name}=${encoded}; Path=/; Max-Age=${options.maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function parseAdminCookie(
  cookieHeader: string | null | undefined,
  name: AdminCookieName,
): string | null {
  if (cookieHeader === null || cookieHeader === undefined) return null;
  const matches: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    matches.push(part.slice(separator + 1).trim());
  }
  if (matches.length !== 1) return null;
  try {
    const decoded = decodeURIComponent(matches[0] ?? '');
    return decoded === '' ? null : decoded;
  } catch (error: unknown) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export type UrlEncodedBodyOptions = {
  readonly contentType: string | null | undefined;
  readonly body: AsyncIterable<Uint8Array | string>;
  readonly expectedFields: readonly string[];
};

export async function parseUrlEncodedBody(
  options: UrlEncodedBodyOptions,
): Promise<ReadonlyMap<string, string>> {
  const mediaType = options.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/x-www-form-urlencoded') throw new FormBodyError(415);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of options.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > FORM_BODY_LIMIT_BYTES) throw new FormBodyError(413);
    chunks.push(bytes);
  }

  let encoded: string;
  try {
    encoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error: unknown) {
    if (error instanceof TypeError) throw new FormBodyError(400);
    throw error;
  }
  if (/%(?![0-9a-f]{2})/iu.test(encoded)) throw new FormBodyError(400);

  const expected = new Set(options.expectedFields);
  if (expected.size !== options.expectedFields.length) throw new FormBodyError(400);
  const parsed = new Map<string, string>();
  for (const [field, value] of new URLSearchParams(encoded)) {
    if (!expected.has(field) || parsed.has(field)) throw new FormBodyError(400);
    parsed.set(field, value);
  }
  if (parsed.size !== expected.size) throw new FormBodyError(400);
  return parsed;
}
