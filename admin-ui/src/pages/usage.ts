import { html, useState, type VNode } from '../vendor/preact-htm.js';
import { api } from '../api.js';
import { AreaChart } from '../chart.js';
import { num, trackingNote } from '../format.js';
import type { Usage, UsageCount } from '../types.js';
import {
  BarList, Card, DataTable, ErrorBox, Loading, Page, When, useAsync, type Column, RefreshButton, live,
} from '../ui.js';
import { contextNames, installNames } from './user-detail.js';

/** Friendly names for the most common actions; the raw action is kept beside them. */
const actionNames: Readonly<Record<string, string>> = {
  '/dealio': '/dealio komutu',
  '/setup': '/setup komutu',
  '/delete-data': '/delete-data komutu',
  'dealio-open:home': 'DM’deki “Dealio paneli” düğmesi',
};

const setupSteps: Readonly<Record<string, string>> = {
  'prepare-ok': 'Steam profili doğrulandı',
  'confirm-ok': 'Kurulum tamamlandı',
};

const failureNames: Readonly<Record<string, string>> = {
  STEAM_WISHLIST_INACCESSIBLE: 'Wishlist gizli / erişilemiyor',
  STEAM_NOT_FOUND: 'Steam profili bulunamadı',
  INVALID_CONFIGURATION: 'Geçersiz profil girişi',
  INVALID_STORE_COUNTRY: 'Geçersiz bölge',
  STEAM_TIMEOUT: 'Steam zaman aşımı',
  STEAM_UPSTREAM_ERROR: 'Steam hatası',
  STEAM_RATE_LIMITED: 'Steam hız sınırı',
  STEAM_NETWORK_ERROR: 'Ağ hatası',
  SetupCapacityReachedError: 'Kapasite dolu / kayıt kapalı',
  SetupAlreadyCompletedError: 'Zaten kayıtlı',
};

function setupLabel(key: string): string {
  if (setupSteps[key]) return setupSteps[key]!;
  const [step, code = '?'] = key.split(':');
  return `${failureNames[code] ?? code}${step === 'confirm-failed' ? ' (onayda)' : ''}`;
}

const usageColumns = (label: string, name: (key: string) => string): Column<UsageCount>[] => [
  { key: 'key', label, render: (row) => html`${name(row.key)} ${name(row.key) !== row.key ? html`<code class="small muted">${row.key}</code>` : null}`,
    sort: (row) => row.key, csv: (row) => row.key },
  { key: 'count', label: 'Kullanım', align: 'end', render: (row) => num(row.count), sort: (row) => row.count, csv: (row) => row.count },
  { key: 'users', label: 'Kişi', align: 'end', render: (row) => num(row.users), sort: (row) => row.users, csv: (row) => row.users },
];

export function UsagePage(): VNode {
  const [days, setDays] = useState(30);
  const state = useAsync(() => api.get<Usage>(`/api/usage?days=${days}`), [days], live);
  const data = state.data;
  const prepared = data?.setup.find((row) => row.key === 'prepare-ok')?.users ?? 0;
  const completed = data?.setup.find((row) => row.key === 'confirm-ok')?.users ?? 0;
  const failures = data?.setup.filter((row) => row.key.includes('failed')) ?? [];
  return Page({
    title: 'Kullanım',
    subtitle: `Komut ve düğme kullanımı, kurulum hunisi ve kullanıcıların geldiği sunucular (90 gün saklanır). ${trackingNote(data?.telemetrySince)}`,
    actions: html`
      <select class="input" value=${String(days)} aria-label="Dönem"
        onChange=${(event: Event) => setDays(Number((event.target as HTMLSelectElement).value))}>
        <option value="7">Son 7 gün</option><option value="30">Son 30 gün</option><option value="90">Son 90 gün</option>
      </select>
      <${RefreshButton} state=${state} />`,
    children: !data
      ? (state.error ? ErrorBox({ message: state.error, retry: state.reload }) : Loading())
      : html`
        ${Card({ title: 'Günlük aktif kullanıcı', subtitle: 'Gün başına etkileşen farklı kullanıcı', children: html`<${AreaChart} key=${data.days} rows=${data.dailyActive} days=${data.days} unit="kişi-gün" />` })}
        <div class="grid-3">
          ${Card({ title: 'Kurulum hunisi', children: html`
            <ol class="funnel">
              <li><span class="funnel-step">1</span><span>Profil doğrulandı</span><strong>${num(prepared)}</strong></li>
              <li><span class="funnel-step">2</span><span>Kurulum tamamlandı</span><strong>${num(completed)}</strong>
                <small class="muted">${prepared > 0 ? `%${Math.round((completed / prepared) * 100)} dönüşüm` : ''}</small></li>
            </ol>
            <h3 class="sub-head">Başarısız denemeler</h3>
            ${BarList({ rows: failures.map((row) => ({ key: row.key, label: setupLabel(row.key), value: row.users, title: row.key })),
              empty: 'Başarısız deneme yok.' })}` })}
          ${Card({ title: 'Kurulum türü', children: BarList({ rows: data.installs.map((row) => ({
            key: row.key, label: installNames[row.key] ?? row.key, value: row.users })), empty: 'Veri yok.' }) })}
          ${Card({ title: 'Nereden kullanılıyor', children: html`
            ${BarList({ rows: data.contexts.map((row) => ({ key: row.key, label: contextNames[row.key] ?? row.key, value: row.users })) })}
            <h3 class="sub-head">Discord dili</h3>
            ${BarList({ rows: data.locales.slice(0, 8).map((row) => ({ key: row.key, label: row.key, value: row.users })) })}` })}
        </div>
        <div class="grid-2">
          ${Card({ title: 'Eylemler', class: 'card-flush', children: html`<${DataTable}
            columns=${usageColumns('Eylem', (key) => actionNames[key] ?? key)} rows=${data.actions}
            rowKey=${(row: UsageCount) => row.key} csvName="dealio-eylemler" initialSort=${{ key: 'count', direction: 'desc' }}
            pageSize=${15} empty="Henüz etkileşim kaydı yok." />` })}
          ${Card({ title: 'Kullanıcıların geldiği sunucular', class: 'card-flush', children: html`<${DataTable}
            columns=${[
              { key: 'guild', label: 'Sunucu', render: (row: Usage['sources'][number]) => html`<a href=${`#/guilds/${row.guildId}`}>${row.guildName ?? row.guildId}</a>`,
                csv: (row: Usage['sources'][number]) => row.guildName ?? row.guildId },
              { key: 'users', label: 'Kişi', align: 'end', render: (row: Usage['sources'][number]) => num(row.users),
                sort: (row: Usage['sources'][number]) => row.users, csv: (row: Usage['sources'][number]) => row.users },
              { key: 'registered', label: 'Kayıtlı', align: 'end', render: (row: Usage['sources'][number]) => num(row.registeredUsers),
                sort: (row: Usage['sources'][number]) => row.registeredUsers, csv: (row: Usage['sources'][number]) => row.registeredUsers },
              { key: 'last', label: 'Son', render: (row: Usage['sources'][number]) => When({ at: row.lastSeenAt }),
                sort: (row: Usage['sources'][number]) => row.lastSeenAt, csv: (row: Usage['sources'][number]) => row.lastSeenAt },
            ]}
            rows=${data.sources} rowKey=${(row: Usage['sources'][number]) => row.guildId} csvName="dealio-kaynak-sunucular"
            initialSort=${{ key: 'users', direction: 'desc' }} pageSize=${15}
            empty="Henüz sunucudan gelen etkileşim yok (DM ve kişisel kurulum sayılmaz)." />` })}
        </div>`,
  });
}
