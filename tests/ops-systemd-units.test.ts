import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const units = ['deploy', join('deploy', 'azure')].flatMap((directory) => readdirSync(directory)
  .filter((file) => file.endsWith('.service'))
  .map((file) => join(directory, file)));

function serviceSettings(path: string): Map<string, string> {
  const settings = new Map<string, string>();
  let section = '';
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) section = header[1]!;
    else if (section === 'Service' && line.includes('=')) {
      const [key, ...value] = line.split('=');
      settings.set(key!.trim(), value.join('=').trim());
    }
  }
  return settings;
}

describe('systemd units', () => {
  it('finds every Dealio service unit', () => {
    expect(units.length).toBeGreaterThanOrEqual(5);
  });

  it.each(units)('%s runs unprivileged with a read-only system and no kernel access', (path) => {
    const settings = serviceSettings(path);
    expect(settings.get('User')).toMatch(/\S/);
    expect(settings.get('UMask')).toBe('0077');
    for (const key of ['NoNewPrivileges', 'PrivateTmp', 'PrivateDevices', 'ProtectKernelTunables', 'ProtectKernelModules',
      'ProtectKernelLogs', 'ProtectControlGroups', 'ProtectClock', 'ProtectHostname', 'RestrictNamespaces',
      'RestrictRealtime', 'RestrictSUIDSGID', 'LockPersonality']) {
      expect(settings.get(key), key).toBe('true');
    }
    expect(settings.get('SystemCallArchitectures')).toBe('native');
    expect(settings.get('RestrictAddressFamilies')?.split(/\s+/).sort()).toEqual(['AF_INET', 'AF_INET6', 'AF_NETLINK', 'AF_UNIX']);
    // `full`, not `strict`: the process lock lives in ~/.local/state/dealio and the
    // database, deletion journal and .runtime under the checkout, all in /home.
    expect(settings.get('ProtectSystem')).toBe('full');
    expect(settings.has('ProtectHome')).toBe(false);
    // V8's JIT needs writable executable memory.
    expect(settings.has('MemoryDenyWriteExecute')).toBe(false);
  });
});
