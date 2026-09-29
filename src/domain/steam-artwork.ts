/** Keep Steam's actual asset path (including its hash), independently of pricing. */
export function steamArtworkUrl(value: unknown, appId: number): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || !Number.isSafeInteger(appId) || appId < 1) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'steamstatic.com' || url.hostname.endsWith('.steamstatic.com'))
      || !(url.pathname.startsWith(`/steam/apps/${appId}/`) || url.pathname.startsWith(`/store_item_assets/steam/apps/${appId}/`))
      || !/\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}
