import { html, useMemo, useState, type VNode } from './vendor/preact-htm.js';
import { useElementWidth } from './ui.js';
import type { DayCount } from './types.js';

const dayFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

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

/** One series of daily counts: single hue, no legend (the card title names it), hover tooltip, table view. */
export function DailyColumns(props: { rows: readonly DayCount[]; days: number; unit: string; total?: boolean }): VNode {
  const data = useMemo(() => fillDays(props.rows, props.days), [props.rows, props.days]);
  const [ref, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 200;
  const margin = { top: 12, right: 8, bottom: 26, left: 34 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(0, ...data.map((row) => row.count)));
  const slot = data.length > 0 ? innerWidth / data.length : 0;
  const barWidth = Math.max(1, Math.min(24, slot - 2));
  const ticks = [0, 1, 2, 3, 4].map((index) => (max / 4) * index);
  const total = data.reduce((sum, row) => sum + row.count, 0);
  const labelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  const hovered = hover === null ? null : data[hover] ?? null;

  return html`
    <figure class="chart">
      <figcaption class="chart-caption">${props.total === false
        ? html`Bugün: <strong>${(data[data.length - 1]?.count ?? 0).toLocaleString('tr-TR')}</strong> ${props.unit}`
        : html`Son ${props.days} gün: <strong>${total.toLocaleString('tr-TR')}</strong> ${props.unit}`}</figcaption>
      <div class="chart-area" ref=${ref} onMouseLeave=${() => setHover(null)}>
        ${width > 0 ? html`
          <svg width=${width} height=${height} role="img"
            aria-label=${`Günlük ${props.unit}, son ${props.days} gün, toplam ${total}`}>
            <g transform=${`translate(${margin.left},${margin.top})`}>
              ${ticks.map((tick) => {
                const y = innerHeight - (tick / max) * innerHeight;
                return html`<g key=${tick}>
                  <line class="grid" x1="0" x2=${innerWidth} y1=${y} y2=${y} />
                  <text class="axis" x="-8" y=${y} dy="0.32em" text-anchor="end">${tick.toLocaleString('tr-TR')}</text>
                </g>`;
              })}
              ${data.map((row, index) => {
                const barHeight = (row.count / max) * innerHeight;
                const x = index * slot + (slot - barWidth) / 2;
                return html`<g key=${row.day}>
                  ${row.count > 0 ? html`<path class=${`bar ${hover === index ? 'bar-active' : ''}`}
                    d=${columnPath(x, innerHeight - barHeight, barWidth, barHeight)} />` : null}
                  <rect class="hit" x=${index * slot} y="0" width=${Math.max(slot, 1)} height=${innerHeight}
                    onMouseEnter=${() => setHover(index)} />
                  ${labelIndexes.has(index) ? html`<text class="axis" x=${index * slot + slot / 2} y=${innerHeight + 18}
                    text-anchor=${index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>
                    ${dayFormat.format(new Date(`${row.day}T00:00:00Z`))}</text>` : null}
                </g>`;
              })}
              <line class="baseline" x1="0" x2=${innerWidth} y1=${innerHeight} y2=${innerHeight} />
            </g>
          </svg>
          ${hovered ? html`<div class="tooltip" style=${`left:${Math.min(Math.max(margin.left + (hover ?? 0) * slot + slot / 2, 60), width - 60)}px`}>
            <span>${dayFormat.format(new Date(`${hovered.day}T00:00:00Z`))}</span>
            <strong>${hovered.count.toLocaleString('tr-TR')} ${props.unit}</strong>
          </div>` : null}` : null}
      </div>
      <details class="chart-table">
        <summary>Tablo olarak göster</summary>
        <table><thead><tr><th>Gün</th><th class="end">${props.unit}</th></tr></thead>
          <tbody>${[...data].reverse().filter((row) => row.count > 0).map((row) => html`
            <tr key=${row.day}><td>${row.day}</td><td class="end">${row.count.toLocaleString('tr-TR')}</td></tr>`)}</tbody>
        </table>
      </details>
    </figure>`;
}
