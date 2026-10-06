import { useEffect, useState } from './vendor/preact-htm.js';
import { api } from './api.js';
import type { Profile } from './types.js';

/** Discord profiles fetched live by the bot; kept for this browser tab only. */
const cache = new Map<string, Profile | null>();

export function useProfiles(ids: readonly string[]): ReadonlyMap<string, Profile | null> {
  const [, setVersion] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    let active = true;
    const missing = [...new Set(ids)].filter((id) => !cache.has(id));
    void (async () => {
      for (let index = 0; index < missing.length && active; index += 50) {
        const chunk = missing.slice(index, index + 50);
        try {
          const { profiles } = await api.get<{ profiles: Record<string, Profile | null> }>(
            `/api/profiles?ids=${chunk.join(',')}`);
          for (const id of chunk) cache.set(id, profiles[id] ?? null);
        } catch {
          return;
        }
        if (active) setVersion((value) => value + 1);
      }
    })();
    return () => { active = false; };
  }, [key]);
  return cache;
}

export function rememberProfile(profile: Profile | null, id: string): void {
  cache.set(id, profile);
}
