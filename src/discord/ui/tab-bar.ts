import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageComponentInteraction } from 'discord.js';
import { safeLogger } from '../../application/safe-logger.js';
import type { Language } from '../../domain/user-config.js';
import { measureDiscordOperation } from '../interaction-timing.js';
import { tabNames } from './design.js';

/** The four sections of the single Dealio panel. */
export type DealioTab = 'home' | 'games' | 'alerts' | 'settings';
/** A tab, or a screen opened from one (the manual check runs from Home). */
export type PanelTarget = DealioTab | 'check';
/** Opens a target in the message of an already acknowledged component interaction. */
export type Navigate = (target: PanelTarget, component: MessageComponentInteraction) => Promise<void>;

export interface PanelNavigation {
  readonly navigate?: Navigate;
  /** The interaction was already acknowledged with deferUpdate; edit its message instead of replying. */
  readonly inPlace?: boolean;
}

const tabs: readonly DealioTab[] = ['home', 'games', 'alerts', 'settings'];

/**
 * The same tab row under every panel. Custom IDs use the panel's own prefix and
 * session, so each panel's collector receives its tabs. The active tab is
 * highlighted; it stays clickable only below its first screen (e.g. a game detail).
 */
export function buildTabBar(
  prefix: string,
  sessionId: string,
  language: Language,
  options: { readonly active?: DealioTab; readonly activeIsRoot?: boolean; readonly disabled?: boolean } = {},
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(tabs.map((tab) => {
    const active = options.active === tab;
    return new ButtonBuilder()
      .setCustomId(`${prefix}:${sessionId}:tab-${tab}`)
      .setEmoji(tabNames[tab].emoji)
      .setLabel(tabNames[tab].label[language])
      .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(options.disabled === true || (active && options.activeIsRoot !== false));
  }));
}

export function parseTabAction(action: string): DealioTab | null {
  const tab = action.startsWith('tab-') ? action.slice(4) : '';
  return tabs.includes(tab as DealioTab) ? tab as DealioTab : null;
}

/**
 * Hands the panel's message to another screen. The click is acknowledged at
 * once; the current session stops ('handoff') and finishes its queued edits
 * before the target renders, so an old edit cannot overwrite the new screen.
 */
export function handOffPanel(options: {
  readonly component: MessageComponentInteraction;
  readonly target: PanelTarget;
  readonly navigate: Navigate;
  readonly stop: () => void;
  readonly settle: () => Promise<void>;
}): void {
  const acknowledgement = measureDiscordOperation(options.component, 'panel.button-ack', () => options.component.deferUpdate());
  options.stop();
  void (async () => {
    await acknowledgement;
    await options.settle();
    await options.navigate(options.target, options.component);
  })().catch((error: unknown) => safeLogger.error('Dealio panel navigation failed', error));
}
