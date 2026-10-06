import { useEffect, useState } from './vendor/preact-htm.js';

/** Hash routes (`#/users/123`), so any path the server returns is the same page. */
export function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/';
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function usePath(): string {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const update = (): void => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return path;
}
