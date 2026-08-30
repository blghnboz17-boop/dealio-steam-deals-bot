import { isIP } from 'node:net';

const CLIENT_IP_HEADER = 'x-dealio-client-ip';
const CLIENT_IP_HEADER_MAX_LENGTH = 64;
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export type AdminClientIdentityInput = {
  readonly peerAddress: string | undefined;
  readonly rawHeaders: readonly string[];
};

export class AdminClientIdentityError extends Error {
  public readonly name = 'AdminClientIdentityError';
  public readonly status = 400;

  public constructor() {
    super('Invalid admin client identity');
  }
}

export class AdminClientIdentity {
  private constructor(public readonly address: string) {}

  public static parse(input: AdminClientIdentityInput): AdminClientIdentity {
    if (input.peerAddress === undefined || !LOOPBACK_PEERS.has(input.peerAddress)) {
      throw new AdminClientIdentityError();
    }

    const values: string[] = [];
    for (let index = 0; index < input.rawHeaders.length; index += 2) {
      const name = input.rawHeaders[index];
      const value = input.rawHeaders[index + 1];
      if (name === undefined || value === undefined) throw new AdminClientIdentityError();
      if (name.toLowerCase() === CLIENT_IP_HEADER) values.push(value);
    }
    const value = values.length === 1 ? values[0] : undefined;
    if (
      value === undefined ||
      value.length > CLIENT_IP_HEADER_MAX_LENGTH ||
      value.trim() !== value ||
      value.includes('%')
    ) {
      throw new AdminClientIdentityError();
    }

    const version = isIP(value);
    if (version === 4) return new AdminClientIdentity(value);
    if (version !== 6) throw new AdminClientIdentityError();

    const hostname = new URL(`http://[${value}]/`).hostname;
    return new AdminClientIdentity(hostname.slice(1, -1));
  }
}

export function parseAdminClientIdentity(input: AdminClientIdentityInput): AdminClientIdentity {
  return AdminClientIdentity.parse(input);
}
