import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { WishlistViewService } from '../../application/wishlist-view-service.js';
import type { PanelNavigation } from '../ui/tab-bar.js';
import { handleAssistant } from './assistant.js';

export const wishlistCommand = new SlashCommandBuilder()
  .setName('wishlist')
  .setDescription('Open your wishlist, price targets and price history')
  .setDescriptionLocalizations({
    tr: 'İstek listeni, hedef fiyatlarını ve fiyat geçmişini aç',
    de: 'Deine Wunschliste, Wunschpreise und Preisverläufe öffnen',
    fr: 'Ouvrir ta liste de souhaits, tes prix cibles et l’historique des prix',
  });

/** /wishlist opens the Dealio panel at its Wishlist tab. */
export async function handleWishlist(
  interaction: ChatInputCommandInteraction,
  service: WishlistViewService,
  lifecycleSignal?: AbortSignal,
  _thresholdService?: DiscountThresholdService,
  ui: PanelNavigation = {},
): Promise<void> {
  if (!service.assistantService) {
    throw new Error('The Dealio assistant is not configured');
  }
  return handleAssistant(interaction, service.assistantService, service, lifecycleSignal, 'wishlist', ui);
}
