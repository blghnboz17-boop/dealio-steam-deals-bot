import { html, render, useEffect, useState, type VNode } from './vendor/preact-htm.js';
import { api, ApiError, setCsrfToken, whenSignedOut } from './api.js';
import { GamesPage } from './pages/games.js';
import { GuildsPage } from './pages/guilds.js';
import { LogsPage } from './pages/logs.js';
import { OverviewPage } from './pages/overview.js';
import { SystemPage } from './pages/system.js';
import { UserDetailPage } from './pages/user-detail.js';
import { UsersPage } from './pages/users.js';
import { usePath } from './router.js';
import { Toasts } from './actions.js';
import { AnnouncementDetailPage, AnnouncementsPage } from './pages/announcements.js';
import { AuditPage } from './pages/audit.js';
import { GuildDetailPage } from './pages/guilds.js';
import { UsagePage } from './pages/usage.js';

interface SessionResponse {
  readonly authenticated: boolean;
  readonly csrf?: string;
}

const navigation = [
  { path: '/', label: 'Genel bakış', icon: '◧' },
  { path: '/guilds', label: 'Sunucular', icon: '⌂' },
  { path: '/users', label: 'Kullanıcılar', icon: '◉' },
  { path: '/games', label: 'Oyunlar', icon: '▦' },
  { path: '/usage', label: 'Kullanım', icon: '↗' },
  { path: '/announcements', label: 'Duyurular', icon: '✉' },
  { path: '/system', label: 'Sistem', icon: '⚙' },
  { path: '/audit', label: 'Denetim', icon: '✓' },
  { path: '/logs', label: 'Loglar', icon: '≡' },
] as const;

function Login(props: { onSignedIn: (csrf: string) => void }): VNode {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.post<SessionResponse>('/api/login', { token });
      props.onSignedIn(session.csrf ?? '');
    } catch (reason: unknown) {
      setError(reason instanceof ApiError && reason.status === 429
        ? 'Çok fazla hatalı deneme. 15 dakika sonra tekrar dene.'
        : reason instanceof ApiError && reason.status === 401 ? 'Anahtar hatalı.' : 'Giriş yapılamadı.');
    } finally {
      setBusy(false);
    }
  };
  return html`
    <main class="login">
      <form class="card login-card" onSubmit=${submit}>
        <div class="brand"><span class="mark">d</span><span>Dealio <em>Yönetim</em></span></div>
        <p class="muted">Sunucudaki <code>DEALIO_ADMIN_TOKEN</code> değerini gir. Oturum 12 saat sürer ve bot yeniden başlarsa kapanır.</p>
        <label class="field">Yönetici anahtarı
          <input class="input" type="password" autocomplete="current-password" required value=${token}
            onInput=${(event: Event) => setToken((event.target as HTMLInputElement).value)} />
        </label>
        ${error ? html`<p class="form-error" role="alert">${error}</p>` : null}
        <button class="btn btn-primary" type="submit" disabled=${busy || token.length === 0}>${busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
      </form>
    </main>`;
}

function Route(props: { path: string }): VNode {
  const userMatch = /^\/users\/(\d{5,25})$/.exec(props.path);
  if (userMatch) return html`<${UserDetailPage} id=${userMatch[1]} />`;
  const guildMatch = /^\/guilds\/(\d{5,25})$/.exec(props.path);
  if (guildMatch) return html`<${GuildDetailPage} id=${guildMatch[1]} />`;
  const announcementMatch = /^\/announcements\/([0-9a-f-]{36})$/.exec(props.path);
  if (announcementMatch) return html`<${AnnouncementDetailPage} id=${announcementMatch[1]} />`;
  switch (props.path) {
    case '/guilds': return html`<${GuildsPage} />`;
    case '/users': return html`<${UsersPage} />`;
    case '/games': return html`<${GamesPage} />`;
    case '/usage': return html`<${UsagePage} />`;
    case '/announcements': return html`<${AnnouncementsPage} />`;
    case '/audit': return html`<${AuditPage} />`;
    case '/system': return html`<${SystemPage} />`;
    case '/logs': return html`<${LogsPage} />`;
    default: return html`<${OverviewPage} />`;
  }
}

function Shell(props: { onSignOut: () => void }): VNode {
  const path = usePath();
  const section = '/' + (path.split('/')[1] ?? '');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);
  return html`
    <div class="shell">
      <aside class=${`sidebar ${menuOpen ? 'open' : ''}`}>
        <div class="sidebar-top">
          <a class="brand" href="#/"><span class="mark">d</span><span>Dealio <em>Yönetim</em></span></a>
          <button class="btn btn-small menu-toggle" aria-expanded=${menuOpen} onClick=${() => setMenuOpen(!menuOpen)}>Menü</button>
        </div>
        <nav aria-label="Bölümler">
          ${navigation.map((item) => html`<a href=${`#${item.path}`} class=${section === item.path ? 'active' : ''}
            aria-current=${section === item.path ? 'page' : undefined}>
            <span class="nav-icon" aria-hidden="true">${item.icon}</span>${item.label}</a>`)}
        </nav>
        <button class="btn btn-ghost signout" onClick=${props.onSignOut}>Çıkış yap</button>
      </aside>
      <main class="content"><${Route} key=${path} path=${path} /></main>
      <${Toasts} />
    </div>`;
}

function App(): VNode {
  const [state, setState] = useState<'checking' | 'signed-in' | 'signed-out'>('checking');
  useEffect(() => {
    whenSignedOut(() => {
      setCsrfToken(null);
      setState('signed-out');
    });
    // scripts/admin-tunnel.ps1 opens `#login=<token>`: the fragment never reaches a
    // server; it is removed from the address bar and history before signing in.
    const login = /^#login=([^&]+)$/.exec(window.location.hash);
    if (login) window.history.replaceState(null, '', '#/');
    const session = login
      ? api.post<SessionResponse>('/api/login', { token: decodeURIComponent(login[1]!) })
        .catch(() => api.get<SessionResponse>('/api/session'))
      : api.get<SessionResponse>('/api/session');
    session.then((result) => {
      setCsrfToken(result.csrf ?? null);
      setState(result.authenticated ? 'signed-in' : 'signed-out');
    }, () => setState('signed-out'));
  }, []);
  const signOut = (): void => {
    void api.post('/api/logout').finally(() => {
      setCsrfToken(null);
      setState('signed-out');
    });
  };
  if (state === 'checking') return html`<p class="boot">Yükleniyor…</p>`;
  if (state === 'signed-out') {
    return html`<${Login} onSignedIn=${(csrf: string) => {
      setCsrfToken(csrf);
      setState('signed-in');
    }} />`;
  }
  return html`<${Shell} onSignOut=${signOut} />`;
}

const root = document.getElementById('app');
if (root) {
  root.textContent = '';
  render(html`<${App} />`, root);
}
