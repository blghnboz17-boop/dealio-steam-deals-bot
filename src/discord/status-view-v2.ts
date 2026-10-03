import { buildHomePanel } from './home-view.js';
import type { NotificationPreference } from '../domain/notification-preference.js';
import type { WishlistItem } from '../domain/steam.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js';
import type { StatusDashboardResult } from '../application/status-service.js';
import type { CheckStatus } from '../domain/check-state.js';
import { languageLocale, type Language } from '../domain/user-config.js';
import { languageNames, localizer, percentText } from './i18n.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { uiCopy } from './ui/copy.js';
import { countryDisplay, panelHeader, tabAccent } from './ui/design.js';
import { buildTabBar } from './ui/tab-bar.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;

export interface StatusV2Options {
  readonly featuredDeal?: WishlistItem;
  readonly heroGame?: WishlistItem;
  readonly trackedGameCount?: number;
  readonly capturedAt?: string;
  readonly notificationPreference?: NotificationPreference;
  readonly eligibleDealCount?: number;
  readonly mode?: 'home' | 'status';
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly disabled?: boolean;
  /** Show the shared tab row (the panel was opened with navigation). */
  readonly tabs?: boolean;
  /** A one-line result of the last action, such as a Test DM. */
  readonly notice?: string;
}

function buildSettingsPanel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  const { config, checkState, notificationQueue, language } = result;
  const text = uiCopy(language);
  const t = localizer(language);
  const disabled = options.disabled ?? false;
  const prefix = 'status-v2';
  const profileUrl = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const incompleteCount = (checkState?.lastSuccessUnknownPriceCount ?? 0)
    + (checkState?.lastSuccessFailedItemCount ?? 0);
  const failed = checkState?.lastStatus === 'failed' || checkState?.lastStatus === 'unavailable';
  const container = new ContainerBuilder().setAccentColor(config.dmDeliveryBlockedAt
    ? dealioBrand.colors.danger
    : failed || incompleteCount > 0 ? dealioBrand.colors.warning : tabAccent.settings);
  const divider = () => container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const button = (action: string, label: string, emoji: string, style = ButtonStyle.Secondary) => new ButtonBuilder()
    .setCustomId(`${prefix}:${sessionId}:${action}`).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);

  const tracking = config.dmDeliveryBlockedAt
    ? '🔴 ' + t({ tr: 'DM’lerin kapalı', en: 'DMs blocked', de: 'DMs blockiert', fr: 'MP bloqués' })
    : config.enabled ? '✅ ' + t(trackingOn) : '⏸️ ' + t(trackingPaused);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(panelHeader('settings', language,
    t({ tr: 'Hesabın ve tercihlerin', en: 'Your account & preferences', de: 'Dein Konto & deine Vorlieben', fr: 'Ton compte et tes préférences' }),
    `**${tracking}** · ${t({ tr: 'Discord DM', en: 'Discord DM', de: 'Discord-DM', fr: 'MP Discord' })}`)));
  if (options.notice) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${options.notice}`.slice(0, 400)));
  }
  divider();

  const account = [
    `### 👤 ${text.account}`,
    `[${maskSteamId(config.steamId64)}](${profileUrl})`,
    `**${countryDisplay(config.storeCountryCode, language)}** · 🌐 ${languageNames[language]}`,
    `🏷️ ${minimumDiscountText(config.minimumDiscountPercent, language)} · 🎯 **${result.gameDiscountOverrideCount}** ${t({
      tr: 'oyuna özel kural', en: 'game rules', de: 'Spielregeln', fr: 'règles par jeu',
    })}`,
  ].join('\n');
  container.addSectionComponents(options.avatarUrl
    ? new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.avatarUrl).setDescription('Dealio'))
    : new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
      .setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(profileUrl).setLabel('Steam')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### 🗓️ ${t({ tr: 'Kontroller', en: 'Checks', de: 'Prüfungen', fr: 'Vérifications' })}`,
    `🔜 ${t({ tr: 'Bir sonraki kontrol', en: 'Next check', de: 'Nächste Prüfung', fr: 'Prochaine vérification' })}: ${config.enabled
      ? displayTime(checkState?.nextScheduledAt, text.never) : t(trackingPaused).toLocaleLowerCase(languageLocale[language])}`,
    `${localizedCheckStatus(checkState?.lastStatus ?? null, language)} · ${displayTime(checkState?.lastCompletedAt, text.never)}`,
    `-# 🎮 ${displayCount(checkState?.lastSuccessCheckedCount, '—')} ${t({ tr: 'oyun', en: 'games', de: 'Spiele', fr: 'jeux' })} · 🏷️ ${displayCount(checkState?.lastSuccessOnSaleCount, '—')} ${t({
      tr: 'indirimde', en: 'on sale', de: 'im Angebot', fr: 'en promo',
    })} · 💱 ${result.latestPriceCurrencies.join(' / ') || text.never}`,
  ].join('\n')));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### 📨 ${t({ tr: 'Bildirimler', en: 'Alerts', de: 'Benachrichtigungen', fr: 'Alertes' })}`,
    `✅ **${notificationQueue.sent}** ${t({ tr: 'gönderildi', en: 'sent', de: 'gesendet', fr: 'envoyées' })} · 📬 **${notificationQueue.pending + notificationQueue.retry}** ${t({
      tr: 'sırada', en: 'waiting', de: 'wartend', fr: 'en attente',
    })} · ❌ **${notificationQueue.terminalFailed}** ${t({ tr: 'iletilemedi', en: 'undeliverable', de: 'nicht zustellbar', fr: 'non distribuées' })}`,
    t({
      tr: '-# En az indirim oranı tüm oyunlar için geçerli. Tek bir oyuna kural koymak için 🎮 İstek listem’e geç.',
      en: '-# The minimum discount applies to every game. Set a rule for a single game in 🎮 Wishlist.',
      de: '-# Der Mindestrabatt gilt für alle Spiele. Regeln für einzelne Spiele legst du unter 🎮 Wunschliste fest.',
      fr: '-# La réduction minimale s’applique à tous les jeux. Pour une règle propre à un jeu, va dans 🎮 Ma liste.',
    }),
  ].join('\n')));
  if (incompleteCount > 0) {
    const one = incompleteCount === 1;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t({
      tr: `> ⚠️ Son kontrolde **${incompleteCount} oyunun** fiyatını alamadım; indirim sayısına bunlar dahil değil.`,
      en: `> ⚠️ I couldn’t get the price of **${incompleteCount} ${one ? 'game' : 'games'}** in the last check, so ${one ? 'it isn’t' : 'they aren’t'} in the sale count.`,
      de: `> ⚠️ Bei der letzten Prüfung fehlte mir der Preis von **${incompleteCount} ${one ? 'Spiel' : 'Spielen'}**; ${one ? 'es zählt' : 'sie zählen'} nicht zu den Angeboten.`,
      fr: `> ⚠️ Lors de la dernière vérification, il me manquait le prix de **${incompleteCount} ${one ? 'jeu' : 'jeux'}** ; ${one ? 'il n’est pas compté' : 'ils ne sont pas comptés'} dans les promos.`,
    })));
  }
  if (failed) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t({
      tr: '> ⚠️ Son kontrol yarım kaldı. Sayılar bir önceki başarılı kontrolden; güncel fiyatları henüz teyit edemedim.',
      en: '> ⚠️ The last check didn’t finish. These numbers are from the last good check; current prices aren’t confirmed yet.',
      de: '> ⚠️ Die letzte Prüfung wurde nicht abgeschlossen. Die Zahlen stammen von der letzten erfolgreichen Prüfung; aktuelle Preise sind noch nicht bestätigt.',
      fr: '> ⚠️ La dernière vérification n’a pas abouti. Ces chiffres viennent de la dernière vérification réussie ; les prix actuels ne sont pas encore confirmés.',
    })));
  }
  if (config.dmDeliveryBlockedAt) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t({
      tr: '> 🛑 **DM’lerini şimdilik durdurdum.** Discord gizlilik ayarını düzelt, bir Test DM gönder ve bildirimleri yeniden aç.',
      en: '> 🛑 **I’ve paused your DMs for now.** Fix your Discord privacy settings, send a Test DM, then turn alerts back on.',
      de: '> 🛑 **Deine DMs sind vorerst pausiert.** Pass deine Discord-Privatsphäre-Einstellungen an, schick eine Test-DM und schalte die Benachrichtigungen wieder ein.',
      fr: '> 🛑 **J’ai mis tes MP en pause.** Corrige tes paramètres de confidentialité Discord, envoie un MP de test, puis réactive les alertes.',
    })));
  }

  divider();
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      config.enabled
        ? button('disable', t({ tr: 'Bildirimleri durdur', en: 'Pause alerts', de: 'Pausieren', fr: 'Mettre en pause' }), '🔕')
        : button('enable', t({ tr: 'Bildirimleri aç', en: 'Resume alerts', de: 'Wieder einschalten', fr: 'Réactiver' }), '🔔', ButtonStyle.Success),
      button('minimum-discount', t({ tr: 'En az indirim', en: 'Minimum discount', de: 'Mindestrabatt', fr: 'Réduction minimale' }), '🏷️'),
      button('test', t({ tr: 'Test DM', en: 'Test DM', de: 'Test-DM', fr: 'MP de test' }), '✉️'),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('region', t({ tr: 'Bölge', en: 'Region', de: 'Region', fr: 'Région' }), '🌍'),
      button('language', t({ tr: 'Dil', en: 'Language', de: 'Sprache', fr: 'Langue' }), '🌐'),
    ),
  );
  if (options.tabs) {
    divider();
    container.addActionRowComponents(buildTabBar(prefix, sessionId, language, { active: 'settings', disabled }));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

function displayTime(value: string | null | undefined, emptyValue: string): string {
  if (!value) {
    return emptyValue;
  }
  const timestamp = Math.floor(new Date(value).getTime() / 1_000);
  return Number.isSafeInteger(timestamp) ? `<t:${timestamp}:R>` : emptyValue;
}

function displayCount(value: number | null | undefined, emptyValue: string): string {
  return value === null || value === undefined ? emptyValue : String(value);
}

function maskSteamId(steamId64: string): string {
  return `${steamId64.slice(0, 5)}••••••••${steamId64.slice(-4)}`;
}

const trackingOn = { tr: 'Takip açık', en: 'Tracking on', de: 'Überwachung aktiv', fr: 'Suivi actif' } as const;
const trackingPaused = { tr: 'Takip duraklatıldı', en: 'Tracking paused', de: 'Überwachung pausiert', fr: 'Suivi en pause' } as const;

/** "En az **%20** indirim", "At least **20%** off". */
function minimumDiscountText(percent: number, language: Language): string {
  const value = `**${percentText(percent, language)}**`;
  return localizer(language)({
    tr: `En az ${value} indirim`,
    en: `At least ${value} off`,
    de: `Mindestens ${value} Rabatt`,
    fr: `Au moins ${value} de réduction`,
  });
}

function localizedCheckStatus(status: CheckStatus | null, language: Language): string {
  const t = localizer(language);
  if (status === 'success') return '✅ ' + t({ tr: 'Son kontrol sorunsuz', en: 'Last check went fine', de: 'Letzte Prüfung erfolgreich', fr: 'Dernière vérification réussie' });
  if (status === 'unavailable') return '⚠️ ' + t({ tr: 'Steam’e ulaşılamadı', en: 'Couldn’t reach Steam', de: 'Steam nicht erreichbar', fr: 'Steam injoignable' });
  if (status === 'failed') return '🛑 ' + t({ tr: 'Son kontrol yarım kaldı', en: 'Last check didn’t finish', de: 'Letzte Prüfung abgebrochen', fr: 'Dernière vérification interrompue' });
  return '⏳ ' + t({ tr: 'Henüz kontrol yapılmadı', en: 'No check yet', de: 'Noch keine Prüfung', fr: 'Aucune vérification pour l’instant' });
}

export function buildStatusV2Panel(
  result: ReadyStatus,
  sessionId: string,
  options: StatusV2Options = {},
): ContainerBuilder {
  return options.mode === 'home'
    ? buildHomePanel(result, sessionId, options)
    : buildSettingsPanel(result, sessionId, options);
}
