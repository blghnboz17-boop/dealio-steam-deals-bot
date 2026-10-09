import {
  ButtonStyle, MessageFlags, PermissionFlagsBits,
  type ButtonInteraction, type Interaction, type ModalSubmitInteraction,
} from 'discord.js';
import type { SupportTicketService } from '../../application/support-ticket-service.js';
import type { SupportConfig } from '../../config/environment.js';
import { acceptedScreenshots, isSupportTopic, ticketNumber, type SupportTicket } from '../../domain/support-ticket.js';
import type { Language } from '../../domain/user-config.js';
import { localizer } from '../i18n.js';
import { buildNoticePanel, dealioEphemeralV2Flags, type DealioNoticeKind } from '../ui/components-v2.js';
import {
  buildSupportModal, buildTicketClosedNotice, supportClosePrefix, supportModalFields,
  supportOpenCustomId, supportSubmitCustomId,
} from './support-view.js';

export interface SupportInteractionOptions {
  /** Both absent: tickets are not configured on this bot, and the buttons say so. */
  readonly service?: SupportTicketService;
  readonly config?: SupportConfig;
  /** The user's Dealio language, or their Discord client's. */
  readonly languageFor: (discordUserId: string, locale: string) => Language;
}

export function isSupportInteraction(interaction: Interaction): interaction is ButtonInteraction | ModalSubmitInteraction {
  return ((typeof interaction.isButton === 'function' && interaction.isButton())
    || (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()))
    && interaction.customId.startsWith('support:');
}

type Notice = { readonly kind: DealioNoticeKind; readonly title: string; readonly description: string };

function notice(language: Language, value: Notice, button?: Parameters<typeof buildNoticePanel>[4]) {
  return { flags: dealioEphemeralV2Flags, components: [buildNoticePanel(language, value.kind, value.title, value.description, button)] };
}

function alreadyOpen(ticket: SupportTicket, language: Language): Notice {
  const t = localizer(language);
  const number = ticketNumber(ticket.ticketId);
  return ticket.threadId ? {
    kind: 'info',
    title: t({ tr: 'Zaten açık bir ticket’ın var', en: 'You already have an open ticket', de: 'Du hast schon ein offenes Ticket', fr: 'Tu as déjà un ticket ouvert' }),
    description: t({
      tr: `Ticket ${number} seni bekliyor: <#${ticket.threadId}>. Oraya yazman yeterli; sessiz kaldıysa mesajın onu yeniden açar.`,
      en: `Ticket ${number} is waiting for you: <#${ticket.threadId}>. Just write there; if it went quiet, your message reopens it.`,
      de: `Ticket ${number} wartet auf dich: <#${ticket.threadId}>. Schreib einfach dort; war es still, öffnet deine Nachricht es wieder.`,
      fr: `Le ticket ${number} t’attend : <#${ticket.threadId}>. Écris simplement là-bas ; s’il était en pause, ton message le rouvre.`,
    }),
  } : {
    kind: 'info',
    title: t({ tr: 'Ticket’ın hazırlanıyor', en: 'Your ticket is being created', de: 'Dein Ticket wird erstellt', fr: 'Ton ticket est en cours de création' }),
    description: t({
      tr: 'Bir dakika içinde yeniden dener misin?',
      en: 'Could you try again in a minute?',
      de: 'Versuchst du es in einer Minute noch mal?',
      fr: 'Tu peux réessayer dans une minute ?',
    }),
  };
}

function wrongPlace(language: Language): Notice {
  const t = localizer(language);
  return {
    kind: 'warning',
    title: t({ tr: 'Ticket’lar destek sunucusunda açılır', en: 'Tickets open in the support server', de: 'Tickets gibt es auf dem Support-Server', fr: 'Les tickets s’ouvrent sur le serveur d’assistance' }),
    description: t({
      tr: 'Bu buton yalnızca Dealio destek sunucusunda çalışır.',
      en: 'This button only works in the Dealio support server.',
      de: 'Dieser Button funktioniert nur auf dem Dealio-Support-Server.',
      fr: 'Ce bouton ne fonctionne que sur le serveur d’assistance Dealio.',
    }),
  };
}

function failed(language: Language): Notice {
  const t = localizer(language);
  return {
    kind: 'danger',
    title: t({ tr: 'Ticket açamadım', en: 'I couldn’t open a ticket', de: 'Ich konnte kein Ticket öffnen', fr: 'Impossible d’ouvrir un ticket' }),
    description: t({
      tr: 'Discord tarafında geçici bir sorun çıktı. Bir dakika sonra yeniden dener misin?',
      en: 'A temporary problem on Discord’s side got in the way. Could you try again in a minute?',
      de: 'Ein vorübergehendes Problem bei Discord ist aufgetreten. Versuchst du es in einer Minute noch mal?',
      fr: 'Un souci passager côté Discord est survenu. Tu peux réessayer dans une minute ?',
    }),
  };
}

function isStaff(interaction: ButtonInteraction, config: SupportConfig): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads)) return true;
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) return roles.includes(config.teamRoleId);
  return roles !== undefined && 'cache' in roles && roles.cache.has(config.teamRoleId);
}

export async function handleSupportInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  options: SupportInteractionOptions,
): Promise<void> {
  const { service, config } = options;
  const language = options.languageFor(interaction.user.id, interaction.locale);
  if (!service || !config || interaction.guildId !== config.guildId) {
    await interaction.reply(notice(language, wrongPlace(language)));
    return;
  }

  if (interaction.isButton() && interaction.customId === supportOpenCustomId) {
    await openForm(interaction, service, language);
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId === supportSubmitCustomId) {
    await submitForm(interaction, service, language);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith(supportClosePrefix)) {
    await closeTicket(interaction, service, config, language);
  }
}

async function openForm(interaction: ButtonInteraction, service: SupportTicketService, language: Language): Promise<void> {
  // A form has to be the first answer, within Discord's three seconds: the usual case
  // (no ticket on record) shows it at once. A recorded ticket needs a look at Discord.
  if (!service.hasActiveRecord(interaction.user.id)) {
    await interaction.showModal(buildSupportModal(language));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const active = await service.activeTicket(interaction.user.id);
  const t = localizer(language);
  await interaction.editReply(active ? { flags: MessageFlags.IsComponentsV2, components: notice(language, alreadyOpen(active, language)).components }
    : {
        flags: MessageFlags.IsComponentsV2,
        components: notice(language, {
          kind: 'info',
          title: t({ tr: 'Önceki ticket’ın sona ermiş', en: 'Your previous ticket has ended', de: 'Dein vorheriges Ticket ist beendet', fr: 'Ton ticket précédent est terminé' }),
          description: t({
            tr: 'Yenisini hemen açabilirsin.',
            en: 'You can open a new one right away.',
            de: 'Du kannst sofort ein neues öffnen.',
            fr: 'Tu peux en ouvrir un nouveau tout de suite.',
          }),
        }, { button: {
          customId: supportOpenCustomId,
          label: t({ tr: 'Ticket aç', en: 'Open a ticket', de: 'Ticket öffnen', fr: 'Ouvrir un ticket' }),
          emoji: '🎫',
          style: ButtonStyle.Primary,
        } }).components,
      });
}

async function submitForm(interaction: ModalSubmitInteraction, service: SupportTicketService, language: Language): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = localizer(language);
  const topic = interaction.fields.getStringSelectValues(supportModalFields.topic)[0] ?? 'other';
  const description = interaction.fields.getTextInputValue(supportModalFields.description).trim();
  const uploaded = interaction.fields.getUploadedFiles(supportModalFields.screenshots, false);
  const screenshots = acceptedScreenshots([...(uploaded?.values() ?? [])].map((file) => ({
    url: file.url, name: file.name, size: file.size, contentType: file.contentType,
  })));
  const result = await service.open({
    discordUserId: interaction.user.id,
    userName: interaction.user.username,
    guildId: interaction.guildId!,
    channelId: interaction.channelId!,
    topic: isSupportTopic(topic) ? topic : 'other',
    description,
    language,
    screenshots,
  });
  let value: Notice;
  switch (result.kind) {
    case 'opened':
      value = {
        kind: 'success',
        title: t({ tr: 'Ticket’ın açıldı', en: 'Your ticket is open', de: 'Dein Ticket ist offen', fr: 'Ton ticket est ouvert' }),
        description: t({
          tr: `Ticket ${ticketNumber(result.ticket.ticketId)}: <#${result.threadId}>. Ekip orada cevap verecek; Discord sana bildirim gönderir.`,
          en: `Ticket ${ticketNumber(result.ticket.ticketId)}: <#${result.threadId}>. The team will answer there, and Discord will notify you.`,
          de: `Ticket ${ticketNumber(result.ticket.ticketId)}: <#${result.threadId}>. Das Team antwortet dort, und Discord benachrichtigt dich.`,
          fr: `Ticket ${ticketNumber(result.ticket.ticketId)} : <#${result.threadId}>. L’équipe répondra là-bas et Discord te préviendra.`,
        }),
      };
      break;
    case 'already-open':
      value = alreadyOpen(result.ticket, language);
      break;
    case 'limit': {
      const at = `<t:${Math.ceil(Date.parse(result.retryAt) / 1000)}:R>`;
      value = {
        kind: 'warning',
        title: t({ tr: 'Bugünlük ticket hakkın doldu', en: 'That’s today’s ticket limit', de: 'Das Ticket-Limit für heute ist erreicht', fr: 'Limite de tickets atteinte pour aujourd’hui' }),
        description: t({
          tr: `Yeni bir ticket’ı ${at} açabilirsin. O zamana kadar son ticket’ına yazabilirsin.`,
          en: `You can open another one ${at}. Until then, you can add to your latest ticket.`,
          de: `Ein neues kannst du ${at} öffnen. Bis dahin kannst du in dein letztes Ticket schreiben.`,
          fr: `Tu pourras en ouvrir un autre ${at}. D’ici là, tu peux écrire dans ton dernier ticket.`,
        }),
      };
      break;
    }
    case 'failed':
      value = failed(language);
      break;
  }
  await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: notice(language, value).components });
}

async function closeTicket(
  interaction: ButtonInteraction,
  service: SupportTicketService,
  config: SupportConfig,
  language: Language,
): Promise<void> {
  const t = localizer(language);
  const ticketId = Number(interaction.customId.slice(supportClosePrefix.length));
  const result = Number.isSafeInteger(ticketId) && ticketId > 0
    ? service.close(ticketId, interaction.user.id, isStaff(interaction, config))
    : { kind: 'not-found' as const };
  if (result.kind === 'forbidden') {
    await interaction.reply(notice(language, {
      kind: 'warning',
      title: t({ tr: 'Bu ticket’ı kapatamazsın', en: 'You can’t close this ticket', de: 'Du kannst dieses Ticket nicht schließen', fr: 'Tu ne peux pas fermer ce ticket' }),
      description: t({
        tr: 'Bir ticket’ı yalnızca açan kişi ya da Dealio ekibi kapatabilir.',
        en: 'Only the person who opened a ticket or the Dealio team can close it.',
        de: 'Nur wer das Ticket geöffnet hat oder das Dealio-Team kann es schließen.',
        fr: 'Seule la personne qui a ouvert le ticket ou l’équipe Dealio peut le fermer.',
      }),
    }));
    return;
  }
  if (result.kind !== 'closed') {
    await interaction.reply(notice(language, {
      kind: 'info',
      title: t({ tr: 'Bu ticket zaten kapalı', en: 'This ticket is already closed', de: 'Dieses Ticket ist schon geschlossen', fr: 'Ce ticket est déjà fermé' }),
      description: t({
        tr: 'Yeni bir şey sormak istersen destek kanalından yeni bir ticket açabilirsin.',
        en: 'To ask something new, open a new ticket from the support channel.',
        de: 'Für eine neue Frage öffne ein neues Ticket im Support-Kanal.',
        fr: 'Pour une nouvelle question, ouvre un nouveau ticket depuis le salon d’assistance.',
      }),
    }));
    return;
  }
  // The announcement goes in before the lock: a locked thread takes no new messages.
  await interaction.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [buildTicketClosedNotice(result.ticket, interaction.user.id, language)],
    allowedMentions: { parse: [] },
  });
  await service.finishClose(result.ticket, interaction.user.id);
}
