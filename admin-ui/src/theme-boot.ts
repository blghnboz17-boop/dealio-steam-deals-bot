// Loaded as a classic script in <head> before the stylesheet applies, so the saved
// theme is set before the first paint (no flash). The CSP forbids inline scripts.
(() => {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem('dealio-admin-theme');
  } catch {
    // Storage can be blocked; fall back to the system setting.
  }
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark' ? saved : system;
})();
