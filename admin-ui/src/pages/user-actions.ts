import { html, useState, type VNode } from '../vendor/preact-htm.js';
import { ConfirmDialog, Dialog, useAction } from '../actions.js';
import { AnnouncementEditor, filledLanguages, type Content } from '../announcement-editor.js';
import { languageNames } from '../format.js';
import { navigate } from '../router.js';
import type { UserDetail } from '../types.js';

type Open = null | 'message' | 'settings' | 'block' | 'delete' | 'pause';

const commonCountries = ['TR', 'US', 'DE', 'GB', 'FR', 'NL', 'PL', 'ES', 'IT', 'BR', 'RU', 'UA', 'AZ', 'KZ', 'CA', 'AU', 'JP', 'IN'];

/** Owner actions for one user; each one is audited on the server. */
export function UserActions(props: { detail: UserDetail; onChanged: () => void }): VNode {
  const { config } = props.detail;
  const id = config.discordUserId;
  const { busy, run } = useAction();
  const [open, setOpen] = useState<Open>(null);
  const [content, setContent] = useState<Content>({});
  const [country, setCountry] = useState(config.storeCountryCode);
  const [language, setLanguage] = useState(config.language);
  const after = (result: unknown): void => {
    if (result !== null) {
      setOpen(null);
      props.onChanged();
    }
  };
  const base = `/api/users/${id}`;

  return html`
    <div class="action-bar" role="toolbar" aria-label="Kullanıcı işlemleri">
      ${config.enabled
        ? html`<button class="btn" disabled=${busy !== null} onClick=${() => setOpen('pause')}>⏸ İzlemeyi durdur</button>`
        : html`<button class="btn" disabled=${busy !== null}
            onClick=${() => run('resume', `${base}/resume`, {}, config.dmDeliveryBlockedAt ? 'İzleme açıldı, DM engeli temizlendi' : 'İzleme açıldı').then(after)}>
            ▶ ${config.dmDeliveryBlockedAt ? 'İzlemeyi aç ve DM engelini temizle' : 'İzlemeyi aç'}</button>`}
      <button class="btn" disabled=${busy !== null}
        onClick=${() => run<{ status: string; checked?: number; sent?: number }>('check', `${base}/check`, {}, 'Kontrol tamamlandı').then((result) => {
          if (result) props.onChanged();
        })}>${busy === 'check' ? 'Kontrol ediliyor…' : '↻ Şimdi kontrol et'}</button>
      <button class="btn" disabled=${busy !== null}
        onClick=${() => run('test', `${base}/test-alert`, {}, 'Test uyarısı gönderildi')}>🔔 Test uyarısı</button>
      <button class="btn" disabled=${busy !== null || Boolean(config.dmDeliveryBlockedAt) || props.detail.blocked}
        title=${config.dmDeliveryBlockedAt ? 'Kullanıcı DM almıyor' : ''} onClick=${() => setOpen('message')}>✉ DM gönder</button>
      <button class="btn" disabled=${busy !== null} onClick=${() => setOpen('settings')}>⚙ Bölge ve dil</button>
      <span class="toolbar-spacer"></span>
      ${props.detail.blocked
        ? html`<button class="btn" disabled=${busy !== null}
            onClick=${() => run('unblock', `${base}/unblock`, {}, 'Engel kaldırıldı').then(after)}>Engeli kaldır</button>`
        : html`<button class="btn btn-danger" disabled=${busy !== null} onClick=${() => setOpen('block')}>⛔ Engelle</button>`}
      <button class="btn btn-danger" disabled=${busy !== null} onClick=${() => setOpen('delete')}>🗑 Verileri sil</button>
    </div>

    ${open === 'pause' ? html`<${ConfirmDialog} title="İzlemeyi durdur" confirmLabel="Durdur" busy=${busy === 'pause'}
      message="Bu kullanıcı için otomatik kontroller ve uyarılar durur. Kurallar, wishlist ve geçmiş korunur; kullanıcı Ayarlar’dan yeniden açabilir."
      onClose=${() => setOpen(null)} onConfirm=${() => run('pause', `${base}/pause`, {}, 'İzleme durduruldu').then(after)} />` : null}

    ${open === 'block' ? html`<${ConfirmDialog} title="Kullanıcıyı engelle" confirmLabel="Engelle" danger typeToConfirm=${id} withReason
      busy=${busy === 'block'}
      message=${html`<p>Engellenen hesap Dealio’nun hiçbir komutunu ve düğmesini kullanamaz (yalnız <code>/delete-data</code> açık kalır) ve izlemesi durdurulur. Verileri silinmez.</p>`}
      onClose=${() => setOpen(null)}
      onConfirm=${(input: { confirm: string; reason: string }) => run('block', `${base}/block`, input, 'Kullanıcı engellendi').then(after)} />` : null}

    ${open === 'delete' ? html`<${ConfirmDialog} title="Verileri kalıcı olarak sil" confirmLabel="Sil" danger typeToConfirm=${id}
      busy=${busy === 'delete'}
      message=${html`<p><code>/delete-data</code> ile aynı silme: yapılandırma, kurallar, wishlist, bildirim geçmişi ve kullanım kayıtları silinir; yedekten geri dönüşe karşı silme günlüğüne yazılır. <strong>Geri alınamaz.</strong></p>`}
      onClose=${() => setOpen(null)}
      onConfirm=${(input: { confirm: string }) => run('delete', `${base}/delete`, { confirm: input.confirm }, 'Veriler silindi').then((result) => {
        if (result !== null) navigate('/users');
      })} />` : null}

    ${open === 'settings' ? html`<${Dialog} title="Bölge ve dil" onClose=${() => setOpen(null)} footer=${html`
        <button class="btn" onClick=${() => setOpen(null)}>Kapat</button>`}>
      <p class="muted">Bölge değişikliği yeni bir fiyat dönemi başlatır: eski bölgedeki bekleyen uyarılar emekliye ayrılır, ilk okuma uyarısız bir taban olur.</p>
      <div class="inline-form">
        <label class="field">Mağaza bölgesi
          <input class="input" list="country-codes" maxLength="2" value=${country}
            onInput=${(event: Event) => setCountry((event.target as HTMLInputElement).value.toUpperCase())} />
          <datalist id="country-codes">${commonCountries.map((code) => html`<option value=${code} />`)}</datalist>
        </label>
        <button class="btn btn-primary" disabled=${busy !== null || country === config.storeCountryCode || !/^[A-Z]{2}$/.test(country)}
          onClick=${() => run('region', `${base}/region`, { country }, 'Bölge değişti').then(after)}>Bölgeyi kaydet</button>
      </div>
      <div class="inline-form">
        <label class="field">Dil
          <select class="input" value=${language} onChange=${(event: Event) => setLanguage((event.target as HTMLSelectElement).value)}>
            ${Object.entries(languageNames).map(([code, name]) => html`<option value=${code}>${name}</option>`)}
          </select>
        </label>
        <button class="btn btn-primary" disabled=${busy !== null || language === config.language}
          onClick=${() => run('language', `${base}/language`, { language }, 'Dil değişti').then(after)}>Dili kaydet</button>
      </div>
    <//>` : null}

    ${open === 'message' ? html`<${Dialog} title="Kullanıcıya DM gönder" wide onClose=${() => setOpen(null)} footer=${html`
        <span class="muted small">Mesaj önce kaydedilir, sonra gönderilir; Duyurular sayfasında izlenir.</span>
        <span class="toolbar-spacer"></span>
        <button class="btn" onClick=${() => setOpen(null)}>Vazgeç</button>
        <button class="btn btn-primary" disabled=${busy !== null || filledLanguages(content).length === 0}
          onClick=${() => run('message', `${base}/message`, { content }, 'Mesaj gönderim kuyruğunda').then((result) => {
            if (result !== null) {
              setContent({});
              after(result);
            }
          })}>Gönder</button>`}>
      <p class="muted">Kullanıcının dili: <strong>${languageNames[config.language] ?? config.language}</strong>. Bu dilde yazman yeterli.</p>
      <${AnnouncementEditor} value=${content} onChange=${setContent} initialLanguage=${config.language} />
    <//>` : null}`;
}
