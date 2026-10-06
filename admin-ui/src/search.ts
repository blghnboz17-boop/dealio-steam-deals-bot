import { html, useEffect, useRef, useState, type VNode } from './vendor/preact-htm.js';
import { api } from './api.js';
import { displayName, num } from './format.js';
import { Icon, type IconName } from './icons.js';
import { useProfiles } from './profiles.js';
import { navigate } from './router.js';
import type { GuildsResponse, UserRow } from './types.js';
import { Avatar } from './ui.js';

export interface SearchPage { readonly path: string; readonly label: string; readonly icon: IconName }

interface Hit {
  readonly key: string;
  readonly group: 'Sayfalar' | 'Kullanıcılar' | 'Sunucular';
  readonly path: string;
  readonly title: string;
  readonly detail: string;
  readonly leading: VNode;
}

interface Directory { readonly users: readonly UserRow[]; readonly guilds: GuildsResponse['guilds'] }

/** The lists are fetched when the palette opens and reused for a minute. */
let directory: { readonly at: number; readonly value: Promise<Directory> } | null = null;

function loadDirectory(): Promise<Directory> {
  if (!directory || Date.now() - directory.at > 60_000) {
    const value = Promise.all([
      api.get<{ users: UserRow[] }>('/api/users'),
      api.get<GuildsResponse>('/api/guilds'),
    ]).then(([users, guilds]) => ({ users: users.users, guilds: guilds.guilds }));
    value.catch(() => { directory = null; });
    directory = { at: Date.now(), value };
  }
  return directory.value;
}

const normalize = (text: string): string => text.toLocaleLowerCase('tr-TR');

/**
 * Ctrl+K: jump to a page, a user (name, @username, Discord ID or SteamID64) or a
 * server (name or ID). Arrow keys move, Enter opens, Escape closes.
 */
export function SearchPalette(props: { pages: readonly SearchPage[]; onClose: () => void }): VNode {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Directory | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLElement | null>(null);
  const profiles = useProfiles(data ? data.users.map((user) => user.discordUserId) : []);

  useEffect(() => {
    input.current?.focus();
    let open = true;
    loadDirectory().then((value) => { if (open) setData(value); }, () => { if (open) setFailed(true); });
    return () => { open = false; };
  }, []);

  // Recomputed on every render: profiles arrive into the same Map, and the lists are small.
  const hits = ((): Hit[] => {
    const needle = normalize(query.trim());
    const pages = props.pages
      .filter((page) => !needle || normalize(page.label).includes(needle))
      .map((page): Hit => ({ key: `p${page.path}`, group: 'Sayfalar', path: page.path, title: page.label, detail: 'Sayfa',
        leading: html`<span class="palette-icon">${Icon({ name: page.icon })}</span>` }));
    if (!needle || !data) return pages;
    const users = data.users.filter((user) => {
      const profile = profiles.get(user.discordUserId);
      return normalize(`${profile?.globalName ?? ''} ${profile?.username ?? ''} ${user.discordUserId} ${user.steamId64}`).includes(needle);
    }).slice(0, 6).map((user): Hit => {
      const profile = profiles.get(user.discordUserId);
      const name = displayName(profile, user.discordUserId);
      return { key: `u${user.discordUserId}`, group: 'Kullanıcılar', path: `/users/${user.discordUserId}`, title: name,
        detail: profile ? `@${profile.username} · ${user.storeCountryCode}` : user.storeCountryCode,
        leading: Avatar({ src: profile?.avatarUrl ?? null, name, size: 28 }) };
    });
    const guilds = data.guilds.filter((guild) => normalize(`${guild.name} ${guild.id}`).includes(needle))
      .slice(0, 5).map((guild): Hit => ({ key: `g${guild.id}`, group: 'Sunucular', path: `/guilds/${guild.id}`, title: guild.name,
        detail: `${num(guild.memberCount)} üye`, leading: Avatar({ src: guild.iconUrl, name: guild.name, size: 28, square: true }) }));
    return [...users, ...guilds, ...pages];
  })();

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (hit: Hit | undefined): void => {
    if (!hit) return;
    props.onClose();
    navigate(hit.path);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(hits.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(hits[active]);
    } else if (event.key === 'Escape') {
      props.onClose();
    }
  };

  const searching = query.trim() !== '';
  let lastGroup = '';
  return html`
    <div class="dialog-backdrop palette-backdrop" onClick=${(event: Event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section class="palette" role="dialog" aria-modal="true" aria-label="Ara">
        <label class="palette-input">${Icon({ name: 'search', size: 18 })}
          <input ref=${input} type="search" value=${query} placeholder="Kullanıcı, sunucu, ID veya sayfa ara…" aria-label="Ara"
            role="combobox" aria-expanded="true" aria-controls="palette-results"
            aria-activedescendant=${hits[active] ? `hit-${hits[active]!.key}` : undefined}
            onInput=${(event: Event) => setQuery((event.target as HTMLInputElement).value)} onKeyDown=${onKey} />
          <kbd>Esc</kbd></label>
        <ul class="palette-results" id="palette-results" role="listbox" ref=${list}>
          ${hits.map((hit, index) => {
            const heading = hit.group !== lastGroup ? html`<li class="palette-group" role="presentation">${hit.group}</li>` : null;
            lastGroup = hit.group;
            return html`${heading}<li key=${hit.key} id=${`hit-${hit.key}`} role="option" aria-selected=${index === active}
              class=${`palette-hit ${index === active ? 'active' : ''}`}
              onMouseMove=${() => setActive(index)} onClick=${() => open(hit)}>
              ${hit.leading}<span class="palette-text"><strong>${hit.title}</strong><small>${hit.detail}</small></span>
              ${index === active ? Icon({ name: 'chevronRight', size: 14 }) : null}</li>`;
          })}
          ${searching && hits.length === 0 ? html`<li class="palette-empty">${data ? 'Sonuç yok.' : failed ? 'Liste yüklenemedi.' : 'Yükleniyor…'}</li>` : null}
        </ul>
        <footer class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> seç</span><span><kbd>Enter</kbd> aç</span>
          <span class="toolbar-spacer"></span>${data ? `${num(data.users.length)} kullanıcı · ${num(data.guilds.length)} sunucu` : ''}</footer>
      </section>
    </div>`;
}
