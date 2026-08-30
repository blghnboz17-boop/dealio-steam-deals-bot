import { csrfInput, escapeHtml, htmlPage } from './html.js';

export type LoginViewModel = {
  readonly username: string;
  readonly csrfToken: string;
  readonly error?: string;
};

export function renderLoginView(model: LoginViewModel): string {
  const alert = model.error === undefined
    ? ''
    : `<div class="state state--critical" role="alert"><strong>Giriş yapılamadı</strong><p>${escapeHtml(model.error)}</p></div>`;
  const body = `<main class="login-cover">
  <section class="login-card" aria-labelledby="login-title">
    <header class="brand-lockup">
      <span class="brand-mark" aria-hidden="true">D</span>
      <div><p class="eyebrow">Yerel operasyon</p><p class="brand-name">Dealio Admin</p></div>
    </header>
    <div class="login-intro">
      <p class="signal-line"><span aria-hidden="true"></span> Güvenli yönetim alanı</p>
      <h1 id="login-title">Komuta <span class="title-keep">merkezine giriş</span></h1>
      <p>Bot sağlığını ve bildirim akışını tek bir güvenli görünümden yönet.</p>
    </div>
    ${alert}
    <form method="post" action="/admin/login" class="login-form">
      ${csrfInput(model.csrfToken)}
      <label for="username">Kullanıcı adı</label>
      <input id="username" name="username" type="text" autocomplete="username" value="${escapeHtml(model.username)}" required>
      <label for="password">Parola</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" class="button button--accent">Giriş yap</button>
    </form>
    <p class="login-note">Yalnızca yetkili operatör erişimi</p>
  </section>
</main>`;
  return htmlPage({ title: 'Giriş | Dealio Admin', body, bodyClass: 'login-page' });
}
