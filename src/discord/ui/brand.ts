import type { APIEmbed } from 'discord.js';

export const dealioBrand = {
  colors: {
    primary: 0x66c0f4,
    accent: 0x8b7cf6,
    success: 0x57f287,
    warning: 0xfee75c,
    danger: 0xed4245,
    neutral: 0x2a475e,
    muted: 0x95a5a6,
  },
  footer: 'Dealio · Steam wishlist alerts',
} as const;

export function withDealioBrand(
  embed: APIEmbed,
  options: { readonly bannerUrl?: string; readonly avatarUrl?: string } = {},
): APIEmbed {
  return {
    color: embed.color ?? dealioBrand.colors.primary,
    ...embed,
    ...(options.bannerUrl ? { image: { url: options.bannerUrl } } : {}),
    ...(!options.bannerUrl && options.avatarUrl
      ? { thumbnail: { url: options.avatarUrl } }
      : {}),
  };
}
