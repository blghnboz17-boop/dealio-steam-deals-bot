# Dealio Admin Design System

## 0. Research Log

- Embedded refs: shortlisted Sentry, PostHog, and Linear; selected operational taste/layout + Sentry because its warm aubergine IDE surfaces, tactile controls, and restrained lime highlight suit a local bot command center. PostHog was more playful and Linear too cool/minimal for incident-led operations.
- Lazyweb: 3 desktop queries (`developer monitoring dashboard incidents health status`, `operations admin dashboard metrics incident table`, `SaaS admin dashboard empty error unavailable states`), 6 screens viewed: Better Stack, incident.io, SigNoz, Semgrep, Sentry, CommandBar.
- Viewed findings: Better Stack contributed compact filter/status hierarchy and metrics-before-table order; incident.io contributed explicit severity rows and useful empty workflow states; SigNoz contributed grouped operational summaries; Sentry contributed fixed navigation, modular metric groups, and in-panel empty states; Semgrep contributed concise recovery copy; CommandBar confirmed that zero activity should remain legible without invented charts.
- Imagen drafts skipped: no image-generation tool exists in this environment.

## 1. Atmosphere & Identity

Dealio Admin is a quiet night-shift command center: warm aubergine-black layers, dense but calm operational facts, and one lime signal reserved for the next safe action. Its signature is the **status rail**: a narrow, high-contrast strip immediately exposing bot, Discord, and data-source health before metrics. Design dials: variance 4, motion 2, density 8. Primary persona: an operator checking the bot under time pressure; constraints include keyboard-only use, low vision, narrow screens, and no exposure of user identifiers or raw errors.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--color-canvas` | `#120d17` | App and login background |
| Sidenav | `--color-sidenav` | `#19111f` | Fixed navigation |
| Surface | `--color-surface` | `#211629` | Primary panels |
| Surface raised | `--color-raised` | `#2a1d33` | Controls and elevated groups |
| Surface hover | `--color-hover` | `#35243f` | Interactive hover only |
| Border | `--color-border` | `#493455` | Structural lines |
| Border strong | `--color-border-strong` | `#7c6487` | Focus-adjacent and emphasized boundaries; 3.68:1 on canvas and 3.05:1 on raised surfaces |
| Text | `--color-text` | `#f7f2f8` | Primary copy |
| Text muted | `--color-muted` | `#b9aebe` | Secondary copy |
| Text dim | `--color-dim` | `#8f8295` | Metadata and disabled copy |
| Accent | `--color-accent` | `#c2ef4e` | Primary action, healthy signal, focus |
| Accent ink | `--color-accent-ink` | `#172006` | Text on accent |
| Warning | `--color-warning` | `#f0b36c` | Degraded and retry states |
| Critical | `--color-critical` | `#ff8f9c` | Failed and unavailable states |
| Info | `--color-info` | `#b7a5f2` | Running and neutral status |
| Scrim | `--color-scrim` | `rgba(9, 5, 12, 0.72)` | Login atmosphere only |

Rules: no other colors; lime is never decorative and appears once per action group; status never relies on color alone; primary text and control pairs target WCAG 2.2 AA.

## 3. Typography

No remote assets. The system stack intentionally favors characterful installed UI faces before platform fallbacks.

| Role | Token | Size / line | Weight / tracking |
|---|---|---|---|
| Page title | `--type-title` | `2rem / 1.1` | 700 / `-0.025em` |
| Section | `--type-section` | `1.25rem / 1.25` | 650 / `-0.012em` |
| Body | `--type-body` | `1rem / 1.5` | 450 / normal |
| Small | `--type-small` | `0.875rem / 1.45` | 500 / normal |
| Label | `--type-label` | `0.75rem / 1.35` | 700 / `0.08em` |
| Metric | `--type-metric` | `1.75rem / 1` | 700 / `-0.025em` |

- UI: `Aptos`, `Segoe UI Variable`, `Segoe UI`, system-ui, sans-serif.
- Mono/numerals: `Cascadia Mono`, `SFMono-Regular`, Consolas, monospace.
- Labels may be uppercase; Turkish body copy uses normal casing. Body text never drops below 14px.

## 4. Spacing & Layout

Base unit: 4px. Tokens: `--space-1: 0.25rem`, `--space-2: 0.5rem`, `--space-3: 0.75rem`, `--space-4: 1rem`, `--space-5: 1.25rem`, `--space-6: 1.5rem`, `--space-8: 2rem`, `--space-10: 2.5rem`, `--space-12: 3rem`.

- Shell: `100dvb` fixed-sidenav grid; sidenav and topbar stay fixed within the shell; `<main>` is the sole vertical scroll owner with `min-block-size: 0`.
- Desktop at 1280: `--sidebar-wide` (15rem) sidenav, fluid main, `--content-max` (90rem) maximum content width.
- Tablet at 768: `--sidebar-tablet` (12rem) compact sidenav and two-column metric groups.
- Mobile at 375: top navigation replaces side placement, brand copy collapses to the mark, all three navigation labels fit without truncation or horizontal scrolling, content reflows to one column, and actions wrap.
- Intrinsic groups use `repeat(auto-fit, minmax(min(15rem, 100%), 1fr))`. Tables become labelled incident cards below 768px rather than requiring primary horizontal scroll.
- Login uses a `cover` primitive; the card is capped at `--login-max` (28rem) and centered with asymmetric tonal atmosphere.

## 5. Components

### Document Shell
- Semantic `header`, labelled `nav`, `main`, and `footer`; stylesheet is `/admin/styles.css`; no inline style/script or remote asset.
- Login variant uses the cover primitive. Dashboard uses fixed-sidenav-shell and scroll-body-shell.
- A running lifecycle action adds a server-rendered two-second refresh to `/admin`; idle, completed, and login documents never auto-refresh.

### Login Card
- Structure: brand mark, title/help, error alert when present, labelled username/password fields, hidden CSRF input, submit action.
- States: default, hover, focus-visible, invalid alert, disabled-ready styling. Touch targets are at least 44px.
- On narrow screens, `merkezine giriş` remains one phrase so `giriş` is never orphaned on its own line.

### Navigation
- Sidenav plus top context bar; current location uses `aria-current="page"`. Logout is a real POST form with CSRF, never a link.
- Mobile reflows into a three-column top region without off-canvas JavaScript, clipping, truncation, or horizontal scrolling.

### Status Strip
- A four-item semantic list for runtime, Discord, active server count, and data. Each item includes text status and a non-color marker. Available, degraded/running, and unavailable variants use semantic tokens.
- `Aktif sunucu` shows the observed integer, including a valid zero. Legacy `null` and unavailable health render `Kullanılamıyor`; they never become a false zero.

### Lifecycle Controls
- POST forms for start, stop, and restart, each with hidden CSRF. An active controller action disables all controls and retains `aria-busy`. Missing or stale health (`unavailable`/`stale`) enables and emphasizes only start; untrusted health (`malformed`/`oversized`/`unsupported`/`future`) disables every action. `stopped`/`failed` enables and emphasizes start; `ready` emphasizes restart and also enables stop; `starting` enables only stop; `stopping` disables every action. Primary emphasis follows the safe next action.

### Metric Group
- `section` with heading and definition-list cells. Numbers use mono. Unavailable telemetry renders an unavailable state rather than zeros. Zero remains a valid value.

### Incident List
- A real table at tablet/desktop with caption and column headers; a labelled list/card transformation on mobile. Only sanitized incident labels, severity, and counts render. No raw code, ID, logs, or error bodies.

### Action Banner and State Panel
- Banner uses `role="status"` for lifecycle outcomes and `role="alert"` for unavailable sources. Empty state explains that no active incident exists; unavailable state gives a safe operator action without technical leakage.

## 6. Motion & Interaction

- No decorative or entry animation. `--motion-fast: 120ms` and `--motion-standard: 180ms`, both `ease-out`, apply only to color, border-color, transform, and opacity on interactive feedback.
- Active buttons translate by one tokenized pixel (`--press-offset: 1px`). `prefers-reduced-motion: reduce` removes transitions and transforms.
- Focus is a 3px accent outline with a 2px canvas offset. Hover never carries information unavailable to keyboard focus.

## 7. Depth & Surface

Mixed tonal-shift and restrained tactile inset depth, adapted from Sentry without glass blur.

- `--radius-control: 0.5rem`, `--radius-panel: 0.75rem`, `--radius-pill: 999px`.
- `--shadow-panel: 0 1rem 3rem rgba(7, 4, 10, 0.28)` for login and action banner only.
- `--shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.06)` for buttons and raised controls.
- `--disabled-opacity: 0.7`; `--accent-hover-filter: brightness(0.92)` for control feedback only.
- Panels separate through tonal shifts plus one border; metrics are grouped by rules and whitespace, not nested card boxes.

## 8. Accessibility Constraints & Accepted Debt

- WCAG 2.2 AA target; 4.5:1 body and 3:1 large/control boundaries; full keyboard order; visible focus; semantic landmarks/headings; table captions; labelled forms; 44px controls; `lang="tr"`; reduced motion honored.
- Long Turkish labels wrap intentionally. Unbroken external values use `overflow-wrap: anywhere`, though raw identifiers must never be rendered.
- Error, empty, degraded, running, and unavailable meanings include words, not color alone.
- Browser QA completed on 2026-08-29 for login and dashboard at 375/768/1280, keyboard focus, forced reduced motion, safe and blocked lifecycle states, and busy-to-completed behavior; fresh evidence is stored under `.omo/evidence/final-admin-review/`.
