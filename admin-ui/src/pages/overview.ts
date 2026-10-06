import { html, type VNode } from '../vendor/preact-htm.js';
import { api } from '../api.js';
import { DailyColumns, fillDays } from '../chart.js';
import {
  checkStatusNames, compact, country, duration, flag, bytes, languageNames, notificationModeNames, num, relative,
} from '../format.js';
import type { Overview } from '../types.js';
import {
  Badge, BarList, Card, ErrorBox, Facts, Loading, Page, Stat, useAsync, useTicker, RefreshButton, live,
} from '../ui.js';

export function SchedulerFacts(props: { scheduler: Overview['scheduler'] }): VNode {
  const { scheduler } = props;
  const last = scheduler.lastRun;
  return Facts({ rows: [
    ['Durum', scheduler.running
      ? Badge({ tone: 'info', label: `Tarıyor (${relative(scheduler.runStartedAt)} başladı)` })
      : Badge({ tone: 'neutral', label: 'Beklemede' })],
    ['Sonraki tarama', scheduler.nextScheduledAt ? relative(scheduler.nextScheduledAt) : '—'],
    ['Aralık', duration(scheduler.intervalMs)],
    ['Son tarama', last ? `${relative(last.completedAt)} · ${duration(last.durationMs)}` : 'Bu açılıştan beri yok'],
    ['Son taramada', last
      ? `${num(last.completedCount)}/${num(last.userCount)} kullanıcı · ${num(last.checkedGames)} oyun · ${num(last.dmSent)} DM`
      : '—'],
    ['Son tarama hataları', last
      ? `${num(last.errorCount)} kullanıcı · ${num(last.steamItemErrors)} oyun hatası · ${num(last.dmFailed)} DM hatası`
      : '—'],
  ] });
}

/** Servers at the end of each day, carried forward over days without changes. */
function GuildHistory(props: { rows: Overview['charts']['guilds'] }): VNode {
  const rows = fillDays([], 90).map((row) => ({
    day: row.day,
    count: props.rows.filter((change) => change.day <= row.day).pop()?.count ?? 0,
  }));
  return html`<${DailyColumns} rows=${rows} days=${90} unit="sunucu (gün sonu)" total=${false} />`;
}

export function OverviewPage(): VNode {
  const state = useAsync(() => api.get<Overview>('/api/overview'), [], live);
  useTicker(30_000);
  const data = state.data;
  const actions = html`<${RefreshButton} state=${state} />`;
  if (!data) {
    return Page({ title: 'Genel bakış', actions,
      children: state.error ? ErrorBox({ message: state.error, retry: state.reload }) : Loading() });
  }
  const { counts } = data;
  const app = data.application;
  return Page({
    title: 'Genel bakış',
    actions,
    children: html`
      ${state.error ? ErrorBox({ message: state.error, retry: state.reload }) : null}
      <div class="stats">
        ${Stat({ label: 'Sunucular', value: num(data.guilds.count),
          sub: `${compact(data.guilds.members)} üye${app?.approximateUserInstallCount !== null && app?.approximateUserInstallCount !== undefined
            ? ` · ${num(app.approximateUserInstallCount)} kişisel kurulum` : ''}` })}
        ${Stat({ label: 'Kayıtlı kullanıcı', value: html`${num(counts.users)}<small> / ${num(data.maxUsers)}</small>`,
          sub: `${data.settings.signupsOpen ? '' : 'Kayıtlar kapalı · '}Son 24 saat +${num(counts.newUsers24h)} · 7 gün +${num(counts.newUsers7d)}`,
          tone: data.settings.signupsOpen ? undefined : 'warn',
          meter: data.maxUsers > 0 ? counts.users / data.maxUsers : 0 })}
        ${Stat({ label: 'Aktif kullanıcı (24 sa)', value: num(data.activity.active24h),
          sub: `7 gün ${num(data.activity.active7d)} · 30 gün ${num(data.activity.active30d)}` })}
        ${Stat({ label: 'İzleme açık', value: num(counts.enabled),
          sub: `${num(counts.paused)} duraklatıldı · ${num(counts.dmBlocked)} DM engelli`,
          tone: counts.dmBlocked > 0 ? 'warn' : undefined })}
        ${Stat({ label: 'Gönderilen uyarı (24 sa)', value: num(counts.alertsSent24h),
          sub: `7 gün ${num(counts.alertsSent7d)} · toplam ${compact(counts.alertsSentTotal)}` })}
        ${Stat({ label: 'Bildirim kuyruğu', value: num(counts.queuePending + counts.queueRetry + counts.queueSending),
          sub: `${num(counts.queuePending)} bekliyor · ${num(counts.queueRetry)} tekrar · ${num(counts.terminalFailed7d)} başarısız (7 g)`,
          tone: counts.terminalFailed7d > 0 ? 'warn' : undefined })}
        ${Stat({ label: 'Takip edilen oyun', value: compact(counts.trackedGames),
          sub: `${num(counts.gamesOnSale)} indirimde · ${num(counts.rules)} özel kural` })}
      </div>

      <div class="grid-2">
        ${Card({ title: 'Yeni kayıtlar', children: html`<${DailyColumns} rows=${data.charts.signups} days=${90} unit="kayıt" />` })}
        ${Card({ title: 'Gönderilen uyarılar', children: html`<${DailyColumns} rows=${data.charts.alerts} days=${30} unit="uyarı" />` })}
        ${Card({ title: 'Günlük aktif kullanıcı', children: html`<${DailyColumns} rows=${data.charts.activeUsers} days=${30} unit="kişi-gün" />` })}
        ${Card({ title: 'Sunucu sayısı', children: html`<${GuildHistory} rows=${data.charts.guilds} />` })}
      </div>

      <div class="grid-3">
        ${Card({ title: 'Bot', children: Facts({ rows: [
          ['Discord', data.discord.ready ? Badge({ tone: 'good', label: 'Bağlı' }) : Badge({ tone: 'bad', label: 'Bağlı değil' })],
          ['Gecikme', data.discord.pingMs === null ? '—' : `${num(data.discord.pingMs)} ms`],
          ['Bot hesabı', data.discord.botUser ? `${data.discord.botUser.username}` : '—'],
          ['Yaklaşık sunucu', num(app?.approximateGuildCount ?? null)],
          ['Kişisel kurulum', num(app?.approximateUserInstallCount ?? null)],
          ['Çalışma süresi', duration(data.process.uptimeSeconds * 1000)],
          ['Bellek (RSS)', bytes(data.process.rssBytes)],
        ] }) })}
        ${Card({ title: 'Tarayıcı', children: SchedulerFacts({ scheduler: data.scheduler }) })}
        ${Card({ title: 'Kontrol durumu', children: html`
          ${BarList({ rows: data.distributions.checkStatuses.map((row) => ({
            key: row.key, label: checkStatusNames[row.key] ?? row.key, value: row.count })) })}
          ${data.distributions.checkErrors.length > 0 ? html`<h3 class="sub-head">Hata kodları</h3>
            ${BarList({ rows: data.distributions.checkErrors.map((row) => ({
              key: row.key, label: html`<code>${row.key}</code>`, value: row.count, title: row.key })) })}` : null}` })}
      </div>

      <div class="grid-3">
        ${Card({ title: 'Mağaza ülkeleri', children: BarList({ rows: data.distributions.countries.map((row) => ({
          key: row.key, label: html`<span class="flag">${flag(row.key)}</span> ${country(row.key)}`, value: row.count })) }) })}
        ${Card({ title: 'Diller', children: BarList({ rows: data.distributions.languages.map((row) => ({
          key: row.key, label: languageNames[row.key] ?? row.key, value: row.count })) }) })}
        ${Card({ title: 'Bildirim zamanlaması', children: html`
          ${BarList({ rows: data.distributions.notificationModes.map((row) => ({
            key: row.key, label: notificationModeNames[row.key] ?? row.key, value: row.count })) })}
          <h3 class="sub-head">Para birimleri (kullanıcı)</h3>
          ${BarList({ rows: data.distributions.currencies.map((row) => ({ key: row.key, label: row.key, value: row.count })) })}` })}
      </div>`,
  });
}
