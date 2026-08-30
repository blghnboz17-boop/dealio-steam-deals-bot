import type { AdminDashboardSnapshot, AdminIncident, RuntimePhase } from '../contracts.js';
import type { BotAction, BotActionSnapshot } from '../bot-controller.js';
import { getLifecyclePolicy } from '../lifecycle-policy.js';
import { escapeHtml, htmlPage, postForm } from './html.js';

export type DashboardViewModel = {
  readonly username: string;
  readonly csrfToken: string;
  readonly dashboard: AdminDashboardSnapshot;
  readonly lifecycle: BotActionSnapshot;
};

const incidentLabels: Readonly<Record<AdminIncident['code'], string>> = {
  batch_retries: 'Bildirim paketi yeniden denenecek',
  batch_terminal_failures: 'Kalıcı bildirim paketi hatası',
  bot_not_ready: 'Bot hazır değil',
  check_failures: 'Wishlist kontrolü başarısız',
  check_unavailable: 'Steam kontrolü kullanılamıyor',
  discord_disconnected: 'Discord bağlantısı kesildi',
  dm_blocked_users: 'DM erişimi engelli kullanıcı',
  health_source_unavailable: 'Sağlık verisi kullanılamıyor',
  notification_retries: 'Bildirim yeniden denenecek',
  notification_terminal_failures: 'Kalıcı bildirim hatası',
  telemetry_source_unavailable: 'Telemetri kullanılamıyor',
};

export function renderDashboardView(model: DashboardViewModel): string {
  const body = `<div class="app-shell">
  <aside class="sidenav">
    <a class="skip-link" href="#ana-icerik">Ana içeriğe geç</a>
    <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">D</span><div><p class="eyebrow">Operasyon</p><p class="brand-name">Dealio</p></div></div>
    <nav aria-label="Ana menü"><a href="/admin" aria-current="page">Genel bakış</a><a href="#olaylar">Olaylar</a><a href="#yasam-dongusu">Bot kontrolü</a></nav>
    <div class="operator"><span>Oturum</span><strong>${escapeHtml(model.username)}</strong></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><div><p class="eyebrow">Yerel yönetim paneli</p><h1>Operasyon merkezi</h1></div>${postForm({ action: '/admin/logout', csrfToken: model.csrfToken, label: 'Çıkış yap', className: 'button button--quiet' })}</header>
    <main id="ana-icerik" tabindex="-1">
      ${actionBanner(model.lifecycle)}
      ${statusStrip(model.dashboard)}
      <div class="page-grid">
        <section class="control-panel" id="yasam-dongusu" aria-labelledby="control-title"><div><p class="eyebrow">Sistem komutları</p><h2 id="control-title">Yaşam döngüsü</h2><p>Bot sürecini kontrollü biçimde başlat, durdur veya yeniden başlat.</p></div>${lifecycleControls(model)}</section>
        ${metricGroups(model.dashboard)}
        ${incidents(model.dashboard.incidents)}
      </div>
    </main>
    <footer><span>Dealio Admin</span><span>Son görünüm: ${formatDate(model.dashboard.generatedAt)}</span></footer>
  </div>
</div>`;
  const page = { title: 'Operasyon Merkezi | Dealio Admin', body, bodyClass: 'dashboard-page' } as const;
  return model.lifecycle.state === 'running'
    ? htmlPage({ ...page, refresh: { seconds: 2, url: '/admin' } })
    : htmlPage(page);
}

function statusStrip(snapshot: AdminDashboardSnapshot): string {
  const health = snapshot.health.status === 'available'
    ? { tone: snapshot.health.phase === 'ready' ? 'healthy' : 'warning', label: runtimeLabel(snapshot.health.phase) }
    : { tone: 'critical', label: 'Sağlık verisi yok' };
  const discord = snapshot.health.status === 'available'
    ? { tone: snapshot.health.discordReady ? 'healthy' : 'critical', label: snapshot.health.discordReady ? 'Bağlı' : 'Bağlantı yok' }
    : { tone: 'critical', label: 'Bilinmiyor' };
  const guilds = snapshot.health.status === 'available' && snapshot.health.guildCount !== null
    ? { tone: 'info', label: escapeHtml(String(snapshot.health.guildCount)) }
    : { tone: 'critical', label: 'Kullanılamıyor' };
  const telemetry = snapshot.telemetry.status === 'available'
    ? { tone: 'healthy', label: 'Güncel' }
    : { tone: 'critical', label: 'Kullanılamıyor' };
  return `<section class="status-section" aria-labelledby="status-title"><div class="section-heading"><p class="eyebrow">Canlı görünüm</p><h2 id="status-title">Sistem durumu</h2></div><ul class="status-strip"><li class="status status--${health.tone}"><span>Bot</span><strong>${health.label}</strong></li><li class="status status--${discord.tone}"><span>Discord</span><strong>${discord.label}</strong></li><li class="status status--${guilds.tone}"><span>Aktif sunucu</span><strong>${guilds.label}</strong></li><li class="status status--${telemetry.tone}"><span>Veri</span><strong>${telemetry.label}</strong></li></ul></section>`;
}

function runtimeLabel(phase: RuntimePhase): string {
  switch (phase) {
    case 'starting': return 'Başlatılıyor';
    case 'ready': return 'Hazır';
    case 'stopping': return 'Durduruluyor';
    case 'stopped': return 'Durduruldu';
    case 'failed': return 'Başarısız';
    default: return assertNever(phase);
  }
}

function lifecycleControls(model: DashboardViewModel): string {
  const policy = getLifecyclePolicy(model.dashboard.health, model.lifecycle);
  const form = (action: BotAction, label: string, className: 'button button--accent' | 'button button--quiet' | 'button button--critical'): string => postForm({
    action: '/admin/bot-action', csrfToken: model.csrfToken, label, className,
    field: { name: 'action', value: action }, disabled: !policy.enabledActions.includes(action), busy: policy.busy,
  });
  return `<div class="control-actions">${form('start', 'Başlat', policy.emphasizedAction === 'start' ? 'button button--accent' : 'button button--quiet')}${form('restart', 'Yeniden başlat', policy.emphasizedAction === 'restart' ? 'button button--accent' : 'button button--quiet')}${form('stop', 'Durdur', 'button button--critical')}</div>`;
}

function actionBanner(snapshot: BotActionSnapshot): string {
  switch (snapshot.state) {
    case 'idle': return '';
    case 'running': return `<section class="action-banner" role="status" aria-busy="true"><span class="pulse" aria-hidden="true"></span><div><strong>${actionLabel(snapshot.action)} sürüyor</strong><p>İşlem tamamlanana kadar diğer yaşam döngüsü komutları bekletilir.</p></div></section>`;
    case 'completed': {
      const succeeded = snapshot.outcome === 'succeeded';
      return `<section class="action-banner action-banner--${succeeded ? 'success' : 'failed'}" role="status"><div><strong>${succeeded ? 'İşlem başarıyla tamamlandı' : 'İşlem tamamlanamadı'}</strong><p>${actionLabel(snapshot.action)} sonucu kaydedildi. Ayrıntılar güvenlik nedeniyle bu görünümde gösterilmez.</p></div></section>`;
    }
    default: return assertNever(snapshot);
  }
}

function actionLabel(action: BotAction): string {
  switch (action) {
    case 'start': return 'Başlatma';
    case 'stop': return 'Durdurma';
    case 'restart': return 'Yeniden başlatma';
    default: return assertNever(action);
  }
}

function metricGroups(snapshot: AdminDashboardSnapshot): string {
  if (snapshot.telemetry.status === 'unavailable') {
    return `<section class="state state--critical metric-unavailable" role="alert"><p class="eyebrow">Veri kaynağı</p><h2>Telemetri kullanılamıyor</h2><p>Yanlış bir sıfır görünümü yerine kaynak geri gelene kadar metrikler gizlendi.</p></section>`;
  }
  const { users, checks, notifications, batches } = snapshot.telemetry;
  return `<div class="metrics" aria-label="Operasyon metrikleri">
    ${metricGroup('Kullanıcılar', [['Yapılandırılmış', users.configured], ['Etkin', users.enabled], ['Duraklatılmış', users.disabled], ['DM engelli', users.dmBlocked]])}
    ${metricGroup('Kontroller', [['Başarılı', checks.statuses.success], ['Bekleyen', checks.statuses.pending], ['Kullanılamıyor', checks.statuses.unavailable], ['Başarısız', checks.statuses.failed]])}
    ${metricGroup('Bildirimler', [['Gönderildi', notifications.statuses.sent], ['Aday', notifications.statuses.candidate], ['Yeniden denenecek', notifications.statuses.failed], ['Kalıcı hata', notifications.statuses.terminalFailed]])}
    ${metricGroup('Paketler', [['Gönderildi', batches.statuses.sent], ['Gönderiliyor', batches.statuses.sending], ['Yeniden denenecek', batches.statuses.failed], ['Süresi doldu', batches.statuses.expired]])}
  </div>`;
}

function metricGroup(title: string, values: readonly (readonly [string, number])[]): string {
  return `<section class="metric-group"><h2>${escapeHtml(title)}</h2><dl>${values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl></section>`;
}

function incidents(items: readonly AdminIncident[]): string {
  if (items.length === 0) {
    return `<section class="empty-state" id="olaylar"><p class="eyebrow">Olay akışı</p><h2>Aktif olay yok</h2><p>İzlenen kaynaklarda operatör müdahalesi gerektiren bir durum bulunmuyor.</p></section>`;
  }
  const rows = items.map((item) => `<tr><td data-label="Önem"><span class="severity severity--${item.severity}">${item.severity === 'critical' ? 'Kritik' : 'Uyarı'}</span></td><th scope="row" data-label="Olay">${escapeHtml(incidentLabels[item.code])}</th><td data-label="Adet">${escapeHtml(String(item.count ?? 1))}</td></tr>`).join('');
  return `<section class="incidents" id="olaylar" aria-labelledby="incidents-title"><div class="section-heading"><p class="eyebrow">Müdahale sırası</p><h2 id="incidents-title">Aktif olaylar</h2></div><div class="table-frame"><table><caption>Aktif olaylar</caption><thead><tr><th scope="col">Önem</th><th scope="col">Olay</th><th scope="col">Adet</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function formatDate(value: string): string {
  const formatted = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));
  return escapeHtml(`${formatted} UTC`);
}

function assertNever(value: never): never {
  throw new TypeError(`Beklenmeyen görünüm durumu: ${String(value)}`);
}
