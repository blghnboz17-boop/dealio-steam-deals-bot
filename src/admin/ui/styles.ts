export const adminStyles = `
:root {
  --color-canvas: #120d17;
  --color-sidenav: #19111f;
  --color-surface: #211629;
  --color-raised: #2a1d33;
  --color-hover: #35243f;
  --color-border: #493455;
  --color-border-strong: #7c6487;
  --color-text: #f7f2f8;
  --color-muted: #b9aebe;
  --color-dim: #8f8295;
  --color-accent: #c2ef4e;
  --color-accent-ink: #172006;
  --color-warning: #f0b36c;
  --color-critical: #ff8f9c;
  --color-info: #b7a5f2;
  --color-scrim: rgba(9, 5, 12, 0.72);
  --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
  --space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-10: 2.5rem; --space-12: 3rem;
  --type-title: 2rem; --type-section: 1.25rem; --type-body: 1rem; --type-small: .875rem; --type-label: .75rem; --type-metric: 1.75rem;
  --radius-control: .5rem; --radius-panel: .75rem; --radius-pill: 999px;
  --sidebar-wide: 15rem; --sidebar-tablet: 12rem; --content-max: 90rem; --login-max: 28rem;
  --shadow-panel: 0 1rem 3rem rgba(7, 4, 10, .28);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, .06);
  --motion-fast: 120ms; --motion-standard: 180ms; --press-offset: 1px; --disabled-opacity: .7; --accent-hover-filter: brightness(.92);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-block-size: 100%; }
body { color: var(--color-text); background: var(--color-canvas); font: 450 var(--type-body)/1.5 Aptos, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
button, input { font: inherit; }
a { color: inherit; }
h1, h2, p { margin-block: 0; }
h1 { font-size: var(--type-title); line-height: 1.1; letter-spacing: -.025em; }
h2 { font-size: var(--type-section); line-height: 1.25; letter-spacing: -.012em; }
.title-keep { white-space: nowrap; }
.eyebrow { color: var(--color-muted); font-size: var(--type-label); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.brand-lockup { display: flex; align-items: center; gap: var(--space-3); }
.brand-mark { display: grid; inline-size: var(--space-10); block-size: var(--space-10); place-items: center; color: var(--color-accent-ink); background: var(--color-accent); border-radius: var(--radius-control); font-weight: 800; box-shadow: var(--shadow-inset); }
.brand-name { font-weight: 700; letter-spacing: -.012em; }
.button { min-block-size: 44px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-control); padding-inline: var(--space-4); color: var(--color-text); background: var(--color-raised); font-size: var(--type-small); font-weight: 700; box-shadow: var(--shadow-inset); cursor: pointer; transition: color var(--motion-fast) ease-out, background-color var(--motion-fast) ease-out, border-color var(--motion-fast) ease-out, transform var(--motion-fast) ease-out; }
.button:hover { background: var(--color-hover); border-color: var(--color-muted); }
.button:active { transform: translateY(var(--press-offset)); }
.button:disabled { color: var(--color-dim); cursor: not-allowed; opacity: var(--disabled-opacity); }
.button--accent { color: var(--color-accent-ink); background: var(--color-accent); border-color: var(--color-accent); }
.button--accent:hover { color: var(--color-accent-ink); background: var(--color-accent); filter: var(--accent-hover-filter); }
.button--critical { color: var(--color-critical); }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
.login-page { background: radial-gradient(circle at 18% 12%, var(--color-raised), transparent 36%), linear-gradient(135deg, var(--color-canvas), var(--color-sidenav)); }
.login-page::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: linear-gradient(90deg, transparent, var(--color-scrim)); }
.login-cover { position: relative; display: grid; min-block-size: 100dvb; place-items: center; padding: var(--space-6); }
.login-card { inline-size: min(var(--login-max), 100%); padding: var(--space-8); border: 1px solid var(--color-border); border-radius: var(--radius-panel); background: linear-gradient(145deg, var(--color-raised), var(--color-surface)); box-shadow: var(--shadow-panel), var(--shadow-inset); }
.login-intro { display: grid; gap: var(--space-3); margin-block: var(--space-10) var(--space-6); }
.login-intro > p:last-child, .login-note, .control-panel p, .action-banner p, .empty-state p, .state p { color: var(--color-muted); }
.signal-line { display: flex; align-items: center; gap: var(--space-2); color: var(--color-accent); font-size: var(--type-small); font-weight: 700; }
.signal-line span, .pulse { inline-size: var(--space-2); block-size: var(--space-2); flex: none; border-radius: var(--radius-pill); background: var(--color-accent); }
.login-form { display: grid; gap: var(--space-2); }
.login-form label { margin-block-start: var(--space-2); font-size: var(--type-small); font-weight: 700; }
.login-form input { min-block-size: 44px; inline-size: 100%; border: 1px solid var(--color-border-strong); border-radius: var(--radius-control); padding-inline: var(--space-3); color: var(--color-text); background: var(--color-canvas); box-shadow: var(--shadow-inset); }
.login-form .button { margin-block-start: var(--space-4); }
.login-note { margin-block-start: var(--space-5); text-align: center; font-size: var(--type-small); }
.state { display: grid; gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-control); background: var(--color-surface); }
.login-card > .state { margin-block-end: var(--space-4); }
.state--critical { border-color: var(--color-critical); }
.app-shell { display: grid; grid-template-columns: var(--sidebar-wide) minmax(0, 1fr); block-size: 100dvb; overflow: hidden; }
.sidenav { display: flex; min-inline-size: 0; flex-direction: column; gap: var(--space-8); padding: var(--space-6); border-inline-end: 1px solid var(--color-border); background: var(--color-sidenav); }
.sidenav nav { display: grid; gap: var(--space-2); }
.sidenav nav a { min-block-size: 44px; display: flex; align-items: center; padding-inline: var(--space-3); border-radius: var(--radius-control); color: var(--color-muted); text-decoration: none; }
.sidenav nav a:hover, .sidenav nav a[aria-current="page"] { color: var(--color-text); background: var(--color-raised); }
.sidenav nav a[aria-current="page"] { box-shadow: inset 3px 0 var(--color-accent); }
.operator { display: grid; gap: var(--space-1); min-inline-size: 0; margin-block-start: auto; color: var(--color-dim); font-size: var(--type-small); }
.operator strong { overflow: hidden; color: var(--color-muted); text-overflow: ellipsis; white-space: nowrap; }
.skip-link { position: fixed; inset-block-start: var(--space-2); inset-inline-start: var(--space-2); z-index: 2; padding: var(--space-3); color: var(--color-accent-ink); background: var(--color-accent); transform: translateY(-150%); }
.skip-link:focus { transform: translateY(0); }
.workspace { display: grid; min-inline-size: 0; min-block-size: 0; grid-template-rows: auto minmax(0, 1fr) auto; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) var(--space-8); border-block-end: 1px solid var(--color-border); background: var(--color-canvas); }
.topbar h1 { font-size: var(--type-section); }
.control-form { display: inline-flex; }
main { min-block-size: 0; overflow-y: auto; overflow-x: hidden; padding: var(--space-8); scrollbar-color: var(--color-border-strong) var(--color-canvas); }
.page-grid { display: grid; gap: var(--space-8); max-inline-size: var(--content-max); margin-inline: auto; }
.action-banner { display: flex; align-items: center; gap: var(--space-4); max-inline-size: var(--content-max); margin: 0 auto var(--space-6); padding: var(--space-4) var(--space-5); border: 1px solid var(--color-info); border-radius: var(--radius-panel); background: var(--color-raised); box-shadow: var(--shadow-panel), var(--shadow-inset); }
.action-banner--success { border-color: var(--color-accent); }
.action-banner--failed { border-color: var(--color-critical); }
.status-section { display: grid; gap: var(--space-4); max-inline-size: var(--content-max); margin: 0 auto var(--space-8); }
.section-heading { display: grid; gap: var(--space-1); }
.status-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 0; border: 1px solid var(--color-border); border-radius: var(--radius-panel); overflow: hidden; list-style: none; background: var(--color-surface); }
.status { position: relative; display: grid; gap: var(--space-1); padding: var(--space-4) var(--space-5); }
.status + .status { border-inline-start: 1px solid var(--color-border); }
.status::before { content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; inline-size: var(--space-1); background: var(--color-info); }
.status--healthy::before { background: var(--color-accent); }
.status--warning::before { background: var(--color-warning); }
.status--critical::before { background: var(--color-critical); }
.status span { color: var(--color-muted); font-size: var(--type-label); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.control-panel { display: flex; align-items: end; justify-content: space-between; gap: var(--space-6); padding-block: var(--space-6); border-block: 1px solid var(--color-border); }
.control-panel > div:first-child { display: grid; gap: var(--space-2); max-inline-size: 42rem; }
.control-actions { display: flex; flex-wrap: wrap; justify-content: end; gap: var(--space-2); }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr)); gap: var(--space-4); }
.metric-group { padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-panel); background: var(--color-surface); box-shadow: var(--shadow-inset); }
.metric-group h2 { padding-block-end: var(--space-4); border-block-end: 1px solid var(--color-border); }
.metric-group dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5) var(--space-3); margin: var(--space-5) 0 0; }
.metric-group dl div { min-inline-size: 0; }
.metric-group dt { color: var(--color-muted); font-size: var(--type-small); }
.metric-group dd { margin: var(--space-2) 0 0; font: 700 var(--type-metric)/1 "Cascadia Mono", "SFMono-Regular", Consolas, monospace; }
.metric-unavailable { padding: var(--space-6); }
.incidents { display: grid; gap: var(--space-4); }
.table-frame { border: 1px solid var(--color-border); border-radius: var(--radius-panel); overflow: hidden; background: var(--color-surface); }
table { inline-size: 100%; border-collapse: collapse; }
caption { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
th, td { padding: var(--space-4); border-block-end: 1px solid var(--color-border); text-align: start; }
thead th { color: var(--color-muted); background: var(--color-raised); font-size: var(--type-label); letter-spacing: .08em; text-transform: uppercase; }
tbody tr:last-child > * { border-block-end: 0; }
.severity { display: inline-flex; align-items: center; min-block-size: var(--space-6); padding-inline: var(--space-2); border: 1px solid currentColor; border-radius: var(--radius-pill); font-size: var(--type-label); font-weight: 700; }
.severity--critical { color: var(--color-critical); }
.severity--warning { color: var(--color-warning); }
.empty-state { display: grid; gap: var(--space-2); padding: var(--space-10); border: 1px dashed var(--color-border-strong); border-radius: var(--radius-panel); text-align: center; background: var(--color-surface); }
footer { display: flex; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) var(--space-8); border-block-start: 1px solid var(--color-border); color: var(--color-dim); background: var(--color-canvas); font-size: var(--type-small); }
@media (min-width: 768px) and (max-width: 1023px) {
  .app-shell { grid-template-columns: var(--sidebar-tablet) minmax(0, 1fr); }
  .sidenav { padding-inline: var(--space-4); }
  main { padding-inline: var(--space-6); }
}
@media (max-width: 767px) {
  .app-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .sidenav { flex-direction: row; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-inline-end: 0; border-block-end: 1px solid var(--color-border); }
  .sidenav .brand-lockup > div, .operator { display: none; }
  .sidenav nav { flex: 1; min-inline-size: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-1); }
  .sidenav nav a { min-inline-size: 0; justify-content: center; padding-inline: var(--space-1); font-size: var(--type-label); white-space: nowrap; }
  .workspace { grid-template-rows: auto minmax(0, 1fr); }
  .topbar { padding: var(--space-3) var(--space-4); }
  .topbar .eyebrow, footer { display: none; }
  main { padding: var(--space-5) var(--space-4); }
  .status-strip { grid-template-columns: 1fr; }
  .status + .status { border-inline-start: 0; border-block-start: 1px solid var(--color-border); }
  .control-panel { align-items: stretch; flex-direction: column; }
  .control-actions { justify-content: stretch; }
  .control-form, .control-form .button { flex: 1; }
  .table-frame { border: 0; overflow: visible; background: transparent; }
  thead { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  table, tbody, tr, th, td { display: block; }
  tbody { display: grid; gap: var(--space-3); }
  tbody tr { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-panel); background: var(--color-surface); }
  tbody th, tbody td { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: var(--space-3); padding: var(--space-2) 0; border: 0; overflow-wrap: anywhere; }
  tbody th::before, tbody td::before { content: attr(data-label); color: var(--color-dim); font-size: var(--type-label); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .login-card { padding: var(--space-6); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto; transition-duration: 0s; animation-duration: 0s; }
  .button { transition-duration: 0s; }
  .button:active { transform: none; }
}
`;
