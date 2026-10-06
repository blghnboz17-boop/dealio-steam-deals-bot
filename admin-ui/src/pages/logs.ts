import { html, useEffect, useMemo, useRef, useState, type VNode } from '../vendor/preact-htm.js';
import { api } from '../api.js';
import type { LogEntry } from '../types.js';
import { Icon } from '../icons.js';
import { Page, SearchInput } from '../ui.js';

const maximumEntries = 2_000;
const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Most lines already start with their own ISO time; the time column shows it. */
const leadingTimestamp = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/;
const levelNames: Record<LogEntry['level'], string> = { info: 'Bilgi', warn: 'Uyarı', error: 'Hata' };

export function LogsPage(): VNode {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [live, setLive] = useState<'connecting' | 'live' | 'paused' | 'lost'>('connecting');
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLElement | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let source: EventSource | null = null;
    let active = true;
    void api.get<{ entries: LogEntry[] }>('/api/logs').then(({ entries: initial }) => {
      if (!active) return;
      setEntries(initial.slice(-maximumEntries));
      source = new EventSource('/api/logs/stream');
      source.onopen = () => setLive('live');
      source.onerror = () => setLive('lost');
      source.onmessage = (event: MessageEvent<string>) => {
        if (pausedRef.current) return;
        const entry = JSON.parse(event.data) as LogEntry;
        setEntries((current) => {
          if (current.length > 0 && current[current.length - 1]!.id >= entry.id) return current;
          const next = [...current, entry];
          return next.length > maximumEntries ? next.slice(-maximumEntries) : next;
        });
      };
    }).catch(() => setLive('lost'));
    return () => {
      active = false;
      source?.close();
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    return entries.filter((entry) => (level === 'all' || entry.level === level || (level === 'warn' && entry.level === 'error'))
      && (!needle || entry.text.toLocaleLowerCase('tr-TR').includes(needle)));
  }, [entries, level, query]);

  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [visible, follow]);

  const liveLabel = paused ? 'Duraklatıldı' : live === 'live' ? 'Canlı' : live === 'lost' ? 'Bağlantı koptu' : 'Bağlanıyor…';
  return Page({
    title: 'Loglar',
    subtitle: 'Bot sürecinin son 1000 satırı (bellekte; gizli değerler maskelenir). Kalıcı kayıt journald’dadır.',
    children: html`
      <div class="card card-flush">
        <div class="toolbar">
          ${SearchInput({ value: query, placeholder: 'Loglarda ara…', onInput: setQuery })}
          <select class="input" value=${level} aria-label="Seviye"
            onChange=${(event: Event) => setLevel((event.target as HTMLSelectElement).value as 'all' | 'warn' | 'error')}>
            <option value="all">Tüm seviyeler</option><option value="warn">Uyarı ve hata</option><option value="error">Yalnız hata</option>
          </select>
          <label class="check"><input type="checkbox" checked=${follow}
            onChange=${(event: Event) => setFollow((event.target as HTMLInputElement).checked)} /> Sona kaydır</label>
          <span class="toolbar-spacer"></span>
          <span class=${`live live-${paused ? 'paused' : live}`}><span class="live-dot" aria-hidden="true"></span>${liveLabel}</span>
          <button class="btn btn-small" onClick=${() => setPaused(!paused)}>${Icon({ name: paused ? 'play' : 'pause', size: 14 })}${paused ? 'Devam et' : 'Duraklat'}</button>
          <button class="btn btn-small" onClick=${() => setEntries([])}>${Icon({ name: 'trash', size: 14 })}Temizle</button>
        </div>
        <ol class="log" ref=${listRef}>
          ${visible.map((entry) => html`<li key=${entry.id} class=${`log-${entry.level}`}>
            <time>${timeFormat.format(new Date(entry.at))}</time>
            <span class="log-level">${levelNames[entry.level]}</span>
            <span class="log-text">${entry.text.replace(leadingTimestamp, '')}</span></li>`)}
        </ol>
        ${visible.length === 0 ? html`<p class="empty">Gösterilecek satır yok.</p>` : null}
      </div>`,
  });
}
