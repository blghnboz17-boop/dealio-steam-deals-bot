import { html, useEffect, useRef, useState, type Child, type VNode } from './vendor/preact-htm.js';
import { api, ApiError } from './api.js';
import { Icon } from './icons.js';

/* Toasts: short confirmations and errors after an action. */

interface Toast { readonly id: number; readonly tone: 'good' | 'bad'; readonly text: string }
let toasts: Toast[] = [];
let nextToast = 1;
const listeners = new Set<() => void>();

export function toast(tone: Toast['tone'], text: string): void {
  const entry = { id: nextToast++, tone, text };
  toasts = [...toasts, entry];
  listeners.forEach((listener) => listener());
  setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== entry.id);
    listeners.forEach((listener) => listener());
  }, tone === 'bad' ? 7000 : 4000);
}

export function Toasts(): VNode {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = (): void => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((item) => html`<div key=${item.id} class=${`toast toast-${item.tone}`}>
      <span class="toast-icon">${Icon({ name: item.tone === 'good' ? 'check' : 'alert' })}</span>${item.text}</div>`)}
  </div>`;
}

export function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'Bilinmeyen hata';
}

/** Runs one admin POST with a busy flag and a toast; resolves to the result or null. */
export function useAction(): { busy: string | null; run: <T>(key: string, path: string, body: unknown, success: string) => Promise<T | null> } {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, path: string, body: unknown, success: string): Promise<T | null> => {
    setBusy(key);
    try {
      const response = await api.post<{ result: T }>(path, body);
      toast('good', success);
      return response.result;
    } catch (error: unknown) {
      toast('bad', errorText(error));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/**
 * A modal dialog. Destructive confirmations ask the owner to type a value (an ID
 * or GÖNDER) before the button unlocks.
 */
export function Dialog(props: {
  title: string;
  onClose: () => void;
  children?: Child;
  footer?: Child;
  wide?: boolean;
}): VNode {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.btn');
    focusable?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return html`
    <div class="dialog-backdrop" onClick=${(event: Event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section class=${`dialog card ${props.wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label=${props.title} ref=${ref}>
        <header class="card-head"><h2>${props.title}</h2>
          <button class="btn btn-small btn-ghost btn-icon" onClick=${props.onClose} aria-label="Kapat">${Icon({ name: 'x' })}</button></header>
        <div class="dialog-body">${props.children}</div>
        ${props.footer ? html`<footer class="dialog-foot">${props.footer}</footer>` : null}
      </section>
    </div>`;
}

export function ConfirmDialog(props: {
  title: string;
  message: Child;
  confirmLabel: string;
  /** The value the owner must type; omit for a simple confirmation. */
  typeToConfirm?: string;
  danger?: boolean;
  withReason?: boolean;
  busy?: boolean;
  onConfirm: (input: { confirm: string; reason: string }) => void;
  onClose: () => void;
}): VNode {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const ready = props.typeToConfirm === undefined || typed.trim() === props.typeToConfirm;
  return html`<${Dialog} title=${props.title} onClose=${props.onClose} footer=${html`
      <button class="btn" onClick=${props.onClose}>Vazgeç</button>
      <button class=${`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} disabled=${!ready || props.busy}
        onClick=${() => props.onConfirm({ confirm: typed.trim(), reason: reason.trim() })}>${props.busy ? 'Çalışıyor…' : props.confirmLabel}</button>`}>
    <div class="dialog-message">${props.message}</div>
    ${props.withReason ? html`<label class="field">Sebep (isteğe bağlı, yalnız sende kalır)
      <input class="input" maxLength="200" value=${reason} onInput=${(event: Event) => setReason((event.target as HTMLInputElement).value)} /></label>` : null}
    ${props.typeToConfirm !== undefined ? html`<label class="field">Onaylamak için <code>${props.typeToConfirm}</code> yaz
      <input class="input" autocomplete="off" spellcheck="false" value=${typed}
        onInput=${(event: Event) => setTyped((event.target as HTMLInputElement).value)} /></label>` : null}
  <//>`;
}
