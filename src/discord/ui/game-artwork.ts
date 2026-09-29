import { ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder } from 'discord.js';
import { steamArtworkUrl } from '../../domain/steam-artwork.js';

interface GameArtwork {
  readonly appId: number;
  readonly headerImageUrl?: string;
  readonly name?: string;
  readonly gameName?: string;
}

export function artworkAccessory(section: SectionBuilder, game: GameArtwork): SectionBuilder {
  const url = steamArtworkUrl(game.headerImageUrl, game.appId);
  return url
    ? section.setThumbnailAccessory(new ThumbnailBuilder().setURL(url).setDescription((game.name ?? game.gameName ?? 'Steam').slice(0, 100)))
    : section.setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Steam').setURL(`https://store.steampowered.com/app/${game.appId}/`));
}

export function addArtwork(container: ContainerBuilder, game: GameArtwork): ContainerBuilder {
  const url = steamArtworkUrl(game.headerImageUrl, game.appId);
  if (url) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
    .setURL(url).setDescription((game.name ?? game.gameName ?? 'Steam').slice(0, 100))));
  return container;
}

export function artworkEmbed(game: GameArtwork): { image?: { url: string } } {
  const url = steamArtworkUrl(game.headerImageUrl, game.appId);
  return url ? { image: { url } } : {};
}
