import { html, useMemo, useState, type VNode } from './vendor/preact-htm.js';
import { useElementSize, type Tone } from './ui.js';
import type { DayCount } from './types.js';

const dayFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'short', timeZone: 'UTC' });
const number = (value: number): string => value.toLocaleString('tr-TR');
const dayLabel = (day: string): string => dayFormat.format(new Date(`${day}T00:00:00Z`));
const longDayLabel = (day: string): string => longDayFormat.format(new Date(`${day}T00:00:00Z`));
let gradientIds = 0;

/** Every UTC day of the window, with zero for days without rows. */
export function fillDays(rows: readonly DayCount[], days: number, now = new Date()): DayCount[] {
  const counts = new Map(rows.map((row) => [row.day, row.count]));
  const result: DayCount[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let index = days - 1; index >= 0; index -= 1) {
    const key = new Date(end - index * 86_400_000).toISOString().slice(0, 10);
    result.push({ day: key, count: counts.get(key) ?? 0 });
  }
  return result;
}

/** A level series (servers at the end of each day) carried forward over days without changes. */
export function carryForward(changes: readonly DayCount[], days: number): DayCount[] {
  return fillDays([], days).map((row) => ({
    day: row.day,
    count: changes.filter((change) => change.day <= row.day).pop()?.count ?? 0,
  }));
}

/** A top value whose four tick steps are whole, clean numbers (1, 2 or 5 × 10ⁿ each). */
function niceMax(value: number): number {
  const raw = Math.max(1, value / 4);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? 10 * power;
  return Math.max(1, Math.ceil(step)) * 4;
}

function columnPath(x: number, y: number, width: number, height: number): string {
  // 4px rounded data end, square at the baseline.
  const radius = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}`
    + `Q${x + width},${y} ${x + width},${y + radius}V${bottom}Z`;
}

/** Monotone cubic path through the points, so a smooth line never overshoots the data. */
function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return '';
  if (points.length < 3) return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join('');
  const slopes: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index]!;
    const [x1, y1] = points[index + 1]!;
    slopes.push((y1 - y0) / (x1 - x0 || 1));
  }
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0]!;
    if (index === points.length - 1) return slopes[slopes.length - 1]!;
    const before = slopes[index - 1]!;
    const after = slopes[index]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  let path = `M${points[0]![0]},${points[0]![1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index]!;
    const [x1, y1] = points[index + 1]!;
    const third = (x1 - x0) / 3;
    path += `C${x0 + third},${y0 + tangents[index]! * third} ${x1 - third},${y1 - tangents[index + 1]! * third} ${x1},${y1}`;
  }
  return path;
}

function ChartTable(props: { data: readonly DayCount[]; unit: string; level: boolean }): VNode {
  const rows = [...props.data].reverse().filter((row) => props.level || row.count > 0);
  return html`<details class="chart-table">
    <summary>Tablo olarak göster</summary>
    <table><thead><tr><th>Gün</th><th class="end">${props.unit}</th></tr></thead>
      <tbody>${rows.map((row) => html`
        <tr key=${row.day}><td>${row.day}</td><td class="end">${number(row.count)}</td></tr>`)}</tbody>
    </table>
  </details>`;
}

/** A filling chart takes its area's measured height (the SVG is absolutely placed, so it never props the area up). */
function chartHeight(props: { readonly height?: number; readonly fill?: boolean }, areaHeight: number): number | undefined {
  return props.fill ? Math.max(props.height ?? 220, Math.floor(areaHeight)) : props.height;
}

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly margin: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly max: number;
}

function frame(width: number, data: readonly DayCount[], height = 220): Frame {
  const margin = { top: 12, right: 8, bottom: 28, left: 36 };
  return {
    width, height, margin,
    innerWidth: Math.max(0, width - margin.left - margin.right),
    innerHeight: height - margin.top - margin.bottom,
    max: niceMax(Math.max(0, ...data.map((row) => row.count))),
  };
}

function Axes(props: { frame: Frame; data: readonly DayCount[]; xOf: (index: number) => number }): VNode {
  const { frame: f, data } = props;
  const ticks = [0, 1, 2, 3, 4].map((index) => (f.max / 4) * index);
  const labels = [0, Math.round((data.length - 1) / 3), Math.round(((data.length - 1) * 2) / 3), data.length - 1];
  return html`
    ${ticks.map((tick) => {
      const y = f.innerHeight - (tick / f.max) * f.innerHeight;
      return html`<g key=${`t${tick}`}>
        ${tick > 0 ? html`<line class="grid" x1="0" x2=${f.innerWidth} y1=${y} y2=${y} />` : null}
        <text class="axis" x="-10" y=${y} dy="0.32em" text-anchor="end">${number(tick)}</text>
      </g>`;
    })}
    ${[...new Set(labels)].map((index, position, all) => data[index] ? html`<text key=${`x${index}`} class="axis" x=${props.xOf(index)}
      y=${f.innerHeight + 20} text-anchor=${position === 0 ? 'start' : position === all.length - 1 ? 'end' : 'middle'}>
      ${dayLabel(data[index]!.day)}</text>` : null)}
    <line class="baseline" x1="0" x2=${f.innerWidth} y1=${f.innerHeight} y2=${f.innerHeight} />`;
}

function Tooltip(props: { left: number; width: number; day: string; value: string }): VNode {
  return html`<div class="tooltip" style=${`left:${Math.min(Math.max(props.left, 70), props.width - 70)}px`}>
    <span>${longDayLabel(props.day)}</span><strong>${props.value}</strong></div>`;
}

function Caption(props: { data: readonly DayCount[]; days: number; unit: string; total: boolean }): VNode {
  const sum = props.data.reduce((total, row) => total + row.count, 0);
  return html`<figcaption class="chart-caption">${props.total
    ? html`<strong>${number(sum)}</strong> ${props.unit} · son ${props.days} gün`
    : html`<strong>${number(props.data[props.data.length - 1]?.count ?? 0)}</strong> ${props.unit} · bugün`}</figcaption>`;
}

/** Daily counts of discrete events: one hue, hover dims the rest and shows a tooltip, table view below. */
export function DailyColumns(props: {
  rows: readonly DayCount[]; days: number; unit: string; total?: boolean; caption?: boolean; height?: number;
  /** Grow to the height the card gives the chart; `height` is then the minimum. */
  fill?: boolean;
}): VNode {
  const data = useMemo(() => fillDays(props.rows, props.days), [props.rows, props.days]);
  const [ref, width, areaHeight] = useElementSize();
  const [hover, setHover] = useState<number | null>(null);
  const f = frame(width, data, chartHeight(props, areaHeight));
  const slot = data.length > 0 ? f.innerWidth / data.length : 0;
  const barWidth = Math.max(1, Math.min(22, slot * 0.68));
  const total = data.reduce((sum, row) => sum + row.count, 0);
  const hovered = hover === null ? null : data[hover] ?? null;
  return html`
    <figure class="chart">
      ${props.caption === false ? null : html`<${Caption} data=${data} days=${props.days} unit=${props.unit} total=${props.total !== false} />`}
      <div class=${`chart-area ${props.fill ? 'chart-fill' : ''}`} ref=${ref} onMouseLeave=${() => setHover(null)}
        style=${props.fill ? `min-height:${props.height ?? 220}px` : ''}>
        ${width > 0 ? html`
          <svg width=${width} height=${f.height} role="img" aria-label=${`Günlük ${props.unit}, son ${props.days} gün, toplam ${total}`}>
            <g transform=${`translate(${f.margin.left},${f.margin.top})`}>
              <${Axes} frame=${f} data=${data} xOf=${(index: number) => index * slot + slot / 2} />
              ${data.map((row, index) => {
                const barHeight = (row.count / f.max) * f.innerHeight;
                const x = index * slot + (slot - barWidth) / 2;
                return html`<g key=${row.day}>
                  ${row.count > 0 ? html`<path class=${`bar ${hover !== null && hover !== index ? 'bar-dim' : ''}`}
                    d=${columnPath(x, f.innerHeight - barHeight, barWidth, barHeight)} />` : null}
                  <rect class="hit" x=${index * slot} y="0" width=${Math.max(slot, 1)} height=${f.innerHeight}
                    onMouseEnter=${() => setHover(index)} />
                </g>`;
              })}
            </g>
          </svg>
          ${hovered ? html`<${Tooltip} left=${f.margin.left + (hover ?? 0) * slot + slot / 2} width=${width}
            day=${hovered.day} value=${`${number(hovered.count)} ${props.unit}`} />` : null}` : null}
      </div>
      <${ChartTable} data=${data} unit=${props.unit} level=${false} />
    </figure>`;
}

/** A level or rate over time: smooth line with a soft fill, crosshair and tooltip, table view below. */
export function AreaChart(props: {
  rows: readonly DayCount[]; days: number; unit: string; total?: boolean; level?: boolean; caption?: boolean; height?: number; fill?: boolean;
}): VNode {
  const data = useMemo(() => props.level ? props.rows.slice(-props.days) : fillDays(props.rows, props.days), [props.rows, props.days, props.level]);
  const [ref, width, areaHeight] = useElementSize();
  const [hover, setHover] = useState<number | null>(null);
  const [gradient] = useState(() => `area-${(gradientIds += 1)}`);
  const f = frame(width, data, chartHeight(props, areaHeight));
  const step = data.length > 1 ? f.innerWidth / (data.length - 1) : 0;
  const points = data.map((row, index): [number, number] => [index * step, f.innerHeight - (row.count / f.max) * f.innerHeight]);
  const line = smoothPath(points);
  const area = points.length > 0 ? `${line}L${points[points.length - 1]![0]},${f.innerHeight}L0,${f.innerHeight}Z` : '';
  const hovered = hover === null ? null : data[hover] ?? null;
  const onMove = (event: MouseEvent): void => {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    const x = event.clientX - box.left - f.margin.left;
    setHover(step > 0 ? Math.max(0, Math.min(data.length - 1, Math.round(x / step))) : 0);
  };
  return html`
    <figure class="chart">
      ${props.caption === false ? null : html`<${Caption} data=${data} days=${props.days} unit=${props.unit} total=${props.total !== false} />`}
      <div class=${`chart-area ${props.fill ? 'chart-fill' : ''}`} ref=${ref} onMouseLeave=${() => setHover(null)}
        style=${props.fill ? `min-height:${props.height ?? 220}px` : ''}>
        ${width > 0 ? html`
          <svg width=${width} height=${f.height} role="img" onMouseMove=${onMove}
            aria-label=${`Günlük ${props.unit}, son ${props.days} gün`}>
            <defs><linearGradient id=${gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" class="gradient-top" /><stop offset="100%" class="gradient-bottom" /></linearGradient></defs>
            <g transform=${`translate(${f.margin.left},${f.margin.top})`}>
              <${Axes} frame=${f} data=${data} xOf=${(index: number) => index * step} />
              <path d=${area} fill=${`url(#${gradient})`} />
              <path class="line" d=${line} />
              ${hovered ? html`<line class="crosshair" x1=${points[hover!]![0]} x2=${points[hover!]![0]} y1="0" y2=${f.innerHeight} />
                <circle class="dot" cx=${points[hover!]![0]} cy=${points[hover!]![1]} r="5" />` : null}
            </g>
          </svg>
          ${hovered ? html`<${Tooltip} left=${f.margin.left + points[hover!]![0]} width=${width}
            day=${hovered.day} value=${`${number(hovered.count)} ${props.unit}`} />` : null}` : null}
      </div>
      <${ChartTable} data=${data} unit=${props.unit} level=${props.level === true} />
    </figure>`;
}

/** The trend under a stat tile: no axes, no hover (the tile's number is the reading). */
export function Sparkline(props: { values: readonly number[]; label: string }): VNode {
  const [gradient] = useState(() => `spark-${(gradientIds += 1)}`);
  const width = 240;
  const height = 44;
  const max = Math.max(1, ...props.values);
  const step = props.values.length > 1 ? width / (props.values.length - 1) : width;
  const points = props.values.map((value, index): [number, number] => [index * step, height - 3 - (value / max) * (height - 8)]);
  const line = smoothPath(points);
  return html`<span class="sparkline" role="img" aria-label=${props.label}>
    <svg viewBox=${`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs><linearGradient id=${gradient} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" class="gradient-top" /><stop offset="100%" class="gradient-bottom" /></linearGradient></defs>
      ${points.length > 1 ? html`<path d=${`${line}L${width},${height}L0,${height}Z`} fill=${`url(#${gradient})`} />
        <path class="line" d=${line} vector-effect="non-scaling-stroke" />` : null}
    </svg></span>`;
}

export interface DonutSlice { readonly key: string; readonly label: string; readonly value: number; readonly tone: Tone }

/** Part-to-whole for a few states (≤ 6). Every slice is also a legend row with its number. */
export function Donut(props: { slices: readonly DonutSlice[]; unit: string }): VNode {
  const [focus, setFocus] = useState<string | null>(null);
  const total = props.slices.reduce((sum, slice) => sum + slice.value, 0);
  const size = 176;
  const stroke = 18;
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const gap = props.slices.filter((slice) => slice.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  const focused = props.slices.find((slice) => slice.key === focus) ?? null;
  return html`<div class="donut-wrap">
    <div class=${`donut ${focus ? 'focused' : ''}`}>
      <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} role="img"
        aria-label=${props.slices.map((slice) => `${slice.label} ${slice.value}`).join(', ')}>
        <circle class="track" cx=${size / 2} cy=${size / 2} r=${radius} stroke-width=${stroke} />
        ${total > 0 ? props.slices.map((slice) => {
          if (slice.value <= 0) return null;
          const length = (slice.value / total) * circumference;
          const dash = `${Math.max(0.5, length - gap)} ${circumference}`;
          const element = html`<circle key=${slice.key} class=${`seg seg-${slice.tone} ${focus === slice.key ? 'on' : ''}`}
            cx=${size / 2} cy=${size / 2} r=${radius} stroke-width=${focus === slice.key ? stroke + 4 : stroke}
            stroke-dasharray=${dash} stroke-dashoffset=${-offset}
            onMouseEnter=${() => setFocus(slice.key)} onMouseLeave=${() => setFocus(null)} />`;
          offset += length;
          return element;
        }) : null}
      </svg>
      <div class="donut-center">
        <strong>${number(focused ? focused.value : total)}</strong>
        <span>${focused ? focused.label : props.unit}</span>
      </div>
    </div>
    <ul class="legend">${props.slices.map((slice) => html`
      <li key=${slice.key} onMouseEnter=${() => setFocus(slice.key)} onMouseLeave=${() => setFocus(null)}>
        <span class=${`swatch swatch-${slice.tone}`}></span>
        <span>${slice.label}</span>
        <strong>${number(slice.value)}</strong>
        <small>%${total > 0 ? Math.round((slice.value / total) * 100) : 0}</small>
      </li>`)}</ul>
  </div>`;
}
