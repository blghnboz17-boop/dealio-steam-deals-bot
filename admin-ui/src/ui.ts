import { html, useCallback, useEffect, useMemo, useRef, useState, type Child, type VNode } from './vendor/preact-htm.js';
import { ApiError } from './api.js';

export interface AsyncState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

/** Loads on mount and when `deps` change; keeps the previous data while reloading. */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    loader().then((value) => {
      if (!active) return;
      setData(value);
      setError(null);
    }, (reason: unknown) => {
      if (!active) return;
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'Bilinmeyen hata');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [...deps, generation]);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return { data, error, loading, reload };
}

export function Page(props: { title: string; subtitle?: Child; actions?: Child; children?: Child }): VNode {
  return html`
    <section class="page">
      <header class="page-head">
        <div>
          <h1>${props.title}</h1>
          ${props.subtitle ? html`<p class="muted">${props.subtitle}</p>` : null}
        </div>
        ${props.actions ? html`<div class="page-actions">${props.actions}</div>` : null}
      </header>
      ${props.children}
    </section>`;
}

export function Card(props: { title?: Child; actions?: Child; class?: string; children?: Child }): VNode {
  return html`
    <article class=${`card ${props.class ?? ''}`}>
      ${props.title || props.actions ? html`
        <header class="card-head">
          ${props.title ? html`<h2>${props.title}</h2>` : html`<span></span>`}
          ${props.actions ?? null}
        </header>` : null}
      ${props.children}
    </article>`;
}

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export function Stat(props: { label: string; value: Child; sub?: Child; tone?: Tone; meter?: number }): VNode {
  const meter = props.meter === undefined ? null : Math.max(0, Math.min(1, props.meter));
  const meterTone = meter === null ? '' : meter >= 0.9 ? 'bad' : meter >= 0.75 ? 'warn' : 'info';
  return html`
    <div class=${`stat ${props.tone ? `stat-${props.tone}` : ''}`}>
      <span class="stat-label">${props.label}</span>
      <strong class="stat-value">${props.value}</strong>
      ${props.sub ? html`<span class="stat-sub">${props.sub}</span>` : null}
      ${meter === null ? null : html`
        <span class=${`meter meter-${meterTone}`} role="meter" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow=${Math.round(meter * 100)}><span style=${`width:${meter * 100}%`}></span></span>`}
    </div>`;
}

const toneIcons: Record<Tone, string> = { good: '●', warn: '▲', bad: '■', info: '◆', neutral: '○' };

/** State is never colour alone: every badge has an icon and a label. */
export function Badge(props: { tone: Tone; label: string; title?: string }): VNode {
  return html`<span class=${`badge badge-${props.tone}`} title=${props.title ?? ''}>
    <span aria-hidden="true">${toneIcons[props.tone]}</span>${props.label}</span>`;
}

export function Avatar(props: { src?: string | null; name: string; size?: number; square?: boolean }): VNode {
  const size = props.size ?? 32;
  const style = `width:${size}px;height:${size}px`;
  return props.src
    ? html`<img class=${`avatar ${props.square ? 'avatar-square' : ''}`} src=${props.src} alt="" style=${style} loading="lazy" />`
    : html`<span class=${`avatar avatar-empty ${props.square ? 'avatar-square' : ''}`} style=${style} aria-hidden="true">
        ${props.name.trim().charAt(0).toUpperCase() || '?'}</span>`;
}

export function Loading(): VNode {
  return html`<div class="state"><span class="spinner" aria-hidden="true"></span> Yükleniyor…</div>`;
}

export function ErrorBox(props: { message: string; retry?: () => void }): VNode {
  return html`<div class="state state-error" role="alert">
    <strong>Yüklenemedi.</strong> ${props.message}
    ${props.retry ? html` <button class="btn btn-small" onClick=${props.retry}>Tekrar dene</button>` : null}
  </div>`;
}

export function Empty(props: { children: Child }): VNode {
  return html`<p class="empty">${props.children}</p>`;
}

export function Facts(props: { rows: ReadonlyArray<readonly [string, Child]> }): VNode {
  return html`<dl class="facts">${props.rows.map(([label, value]) => html`
    <div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>`;
}

export function CopyText(props: { value: string }): VNode {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(props.value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return html`<button class="copy" title="Kopyala" onClick=${copy}><code>${props.value}</code>
    <span class="copy-hint">${copied ? 'kopyalandı' : 'kopyala'}</span></button>`;
}

/** Proportional bars for a small distribution; the number is always printed. */
export function BarList(props: { rows: ReadonlyArray<{ label: Child; value: number; key: string; title?: string }>; empty?: string }): VNode {
  const max = Math.max(1, ...props.rows.map((row) => row.value));
  const total = props.rows.reduce((sum, row) => sum + row.value, 0);
  if (props.rows.length === 0) return Empty({ children: props.empty ?? 'Veri yok.' });
  return html`<ul class="barlist">${props.rows.map((row) => html`
    <li key=${row.key}>
      <span class="barlist-label" title=${row.title ?? (typeof row.label === 'string' ? row.label : '')}>${row.label}</span>
      <span class="barlist-track"><span class="barlist-fill" style=${`width:${(row.value / max) * 100}%`}></span></span>
      <span class="barlist-value">${row.value.toLocaleString('tr-TR')}
        <small>${total > 0 ? `%${Math.round((row.value / total) * 100)}` : ''}</small></span>
    </li>`)}</ul>`;
}

export interface Column<T> {
  readonly key: string;
  readonly label: string;
  readonly render: (row: T) => Child;
  readonly sort?: (row: T) => string | number | null;
  readonly csv?: (row: T) => string | number | null;
  readonly align?: 'end';
  readonly hideOnMobile?: boolean;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv<T>(name: string, columns: readonly Column<T>[], rows: readonly T[]): void {
  const exportable = columns.filter((column) => column.csv);
  const lines = [
    exportable.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => exportable.map((column) => csvCell(column.csv!(row))).join(',')),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataTable<T>(props: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  csvName?: string;
  /** Columns for the CSV export; defaults to the visible columns. */
  csvColumns?: readonly Column<T>[];
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  toolbar?: Child;
  pageSize?: number;
  empty?: string;
}): VNode {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(props.initialSort ?? null);
  const [limit, setLimit] = useState(props.pageSize ?? 50);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    let rows = needle && props.search
      ? props.rows.filter((row) => props.search!(row).toLocaleLowerCase('tr-TR').includes(needle))
      : [...props.rows];
    const column = sort ? props.columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (sort && column?.sort) {
      const direction = sort.direction === 'asc' ? 1 : -1;
      rows = rows.sort((left, right) => {
        const a = column.sort!(left);
        const b = column.sort!(right);
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return (a < b ? -1 : 1) * direction;
      });
    }
    return rows;
  }, [props.rows, query, sort, props.columns]);
  const toggleSort = (key: string): void => setSort((current) =>
    current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' });

  return html`
    <div class="table-wrap">
      ${props.search || props.csvName || props.toolbar ? html`
        <div class="toolbar">
          ${props.search ? html`<input class="input search" type="search" placeholder=${props.searchPlaceholder ?? 'Ara…'}
            value=${query} onInput=${(event: Event) => setQuery((event.target as HTMLInputElement).value)} />` : null}
          ${props.toolbar ?? null}
          <span class="toolbar-spacer"></span>
          <span class="muted small">${filtered.length.toLocaleString('tr-TR')} kayıt</span>
          ${props.csvName ? html`<button class="btn btn-small" onClick=${() => downloadCsv(props.csvName!, props.csvColumns ?? props.columns, filtered)}>CSV indir</button>` : null}
        </div>` : null}
      <div class="table-scroll">
        <table>
          <thead><tr>${props.columns.map((column) => html`
            <th class=${`${column.align === 'end' ? 'end' : ''} ${column.hideOnMobile ? 'hide-mobile' : ''}`}
              aria-sort=${sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
              ${column.sort ? html`<button class="th-sort" onClick=${() => toggleSort(column.key)}>${column.label}
                <span aria-hidden="true">${sort?.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span></button>`
                : column.label}
            </th>`)}</tr></thead>
          <tbody>
            ${filtered.slice(0, limit).map((row) => html`
              <tr key=${props.rowKey(row)} class=${props.onRow ? 'clickable' : ''}
                onClick=${props.onRow ? () => props.onRow!(row) : undefined}>
                ${props.columns.map((column) => html`<td class=${`${column.align === 'end' ? 'end' : ''} ${column.hideOnMobile ? 'hide-mobile' : ''}`}>
                  ${column.render(row)}</td>`)}
              </tr>`)}
          </tbody>
        </table>
        ${filtered.length === 0 ? Empty({ children: props.empty ?? 'Kayıt yok.' }) : null}
      </div>
      ${filtered.length > limit ? html`<button class="btn more" onClick=${() => setLimit(limit + (props.pageSize ?? 50))}>
        Daha fazla göster (${(filtered.length - limit).toLocaleString('tr-TR')} kaldı)</button>` : null}
    </div>`;
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useTicker(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export function useElementWidth(): [{ current: HTMLElement | null }, number] {
  const ref = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
