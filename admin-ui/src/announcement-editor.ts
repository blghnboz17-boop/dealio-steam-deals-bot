import { html, useState, type VNode } from './vendor/preact-htm.js';
import { languageNames } from './format.js';

export type Language = 'tr' | 'en' | 'de' | 'fr';
export const editorLanguages: readonly Language[] = ['tr', 'en', 'de', 'fr'];
export type Content = Partial<Record<Language, { title: string; body: string }>>;

const footers: Record<Language, string> = {
  tr: 'Dealio’dan bir duyuru', en: 'An announcement from Dealio', de: 'Eine Mitteilung von Dealio', fr: 'Une annonce de Dealio',
};
const buttons: Record<Language, string> = { tr: 'Dealio paneli', en: 'Dealio panel', de: 'Dealio-Panel', fr: 'Panneau Dealio' };
export const limits = { title: 100, body: 1800 } as const;

export function filledLanguages(content: Content): Language[] {
  return editorLanguages.filter((language) => content[language]?.title.trim() && content[language]?.body.trim());
}

/** A close look at the Discord message: the same notice panel the bot sends. */
export function DiscordPreview(props: { language: Language; title: string; body: string }): VNode {
  return html`<div class="discord-preview" aria-label="Discord önizlemesi">
    <div class="discord-card">
      <strong class="discord-title">ℹ️ ${props.title || 'Başlık'}</strong>
      <p class="discord-body">${props.body || 'Mesaj metni burada görünür.'}</p>
      <small class="discord-foot">${footers[props.language]}</small>
      <span class="discord-button">🏠 ${buttons[props.language]}</span>
    </div>
  </div>`;
}

/**
 * Title and message per language. A recipient gets their own language, else
 * English, else any language that is filled in.
 */
export function AnnouncementEditor(props: { value: Content; onChange: (value: Content) => void; initialLanguage?: string }): VNode {
  const [active, setActive] = useState<Language>(
    editorLanguages.find((language) => language === props.initialLanguage) ?? 'tr');
  const current = props.value[active] ?? { title: '', body: '' };
  const update = (field: 'title' | 'body', text: string): void => {
    props.onChange({ ...props.value, [active]: { ...current, [field]: text } });
  };
  const filled = filledLanguages(props.value);
  return html`
    <div class="editor">
      <div class="tabs" role="tablist">
        ${editorLanguages.map((language) => html`<button role="tab" aria-selected=${active === language}
          class=${`tab ${active === language ? 'active' : ''}`} onClick=${() => setActive(language)}>
          ${languageNames[language]} ${filled.includes(language) ? html`<span class="tab-dot" aria-label="dolu">●</span>` : null}
        </button>`)}
      </div>
      <div class="editor-grid">
        <div class="editor-fields">
          <label class="field"><span class="field-label">Başlık <small class="muted">${current.title.length}/${limits.title}</small></span>
            <input class="input" maxLength=${limits.title} value=${current.title}
              onInput=${(event: Event) => update('title', (event.target as HTMLInputElement).value)} /></label>
          <label class="field"><span class="field-label">Mesaj <small class="muted">${current.body.length}/${limits.body} · Discord markdown destekler</small></span>
            <textarea class="input" rows="8" maxLength=${limits.body} value=${current.body}
              onInput=${(event: Event) => update('body', (event.target as HTMLTextAreaElement).value)}></textarea></label>
          <p class="muted small">Boş bıraktığın dillerde kullanıcı İngilizce metni, o da yoksa yazdığın başka bir dili görür.</p>
        </div>
        <${DiscordPreview} language=${active} title=${current.title} body=${current.body} />
      </div>
    </div>`;
}
