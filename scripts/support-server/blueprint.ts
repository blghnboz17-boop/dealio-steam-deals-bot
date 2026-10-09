import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { dealioBrand } from '../../src/discord/ui/brand.js';
import { assertComponentsV2Limit } from '../../src/discord/ui/components-v2.js';
import { buildSupportPanel, supportHelpUrl } from '../../src/discord/support/support-view.js';

/**
 * The Dealio support server as data: roles, channels, permissions and the messages
 * Dealio keeps in its info channels. `setup-support-server.ts` applies it; running it
 * again updates what it created instead of adding duplicates (everything is found by name).
 */

const P = PermissionFlagsBits;
const bits = (...flags: bigint[]): string => flags.reduce((all, flag) => all | flag, 0n).toString();

export const publicSiteUrl = 'https://blghnboz17-boop.github.io/dealio-public-pages';
export const links = {
  website: `${publicSiteUrl}/index-en.html`,
  help: supportHelpUrl,
  privacy: `${publicSiteUrl}/privacy.html`,
  terms: `${publicSiteUrl}/terms.html`,
  github: 'https://github.com/blghnboz17-boop/dealio-steam-deals-bot',
  discordGuidelines: 'https://discord.com/guidelines',
  discordTerms: 'https://discord.com/terms',
  invite: (clientId: string) => `https://discord.com/oauth2/authorize?client_id=${clientId}`,
} as const;

export const guildSettings = {
  name: 'Dealio Support',
  description: 'Help, updates and deal talk for Dealio, the Discord bot that watches your Steam wishlist and DMs you when your games hit your price.',
  preferred_locale: 'en-US',
  // Members need a verified email and a five-minute-old account to talk.
  verification_level: 2,
  // Scan media from every member.
  explicit_content_filter: 2,
  // Only @mentions notify, so a busy server never buzzes everyone's phone.
  default_message_notifications: 1,
  // Hide join messages, join-sticker prompts and setup tips; keep boost messages.
  system_channel_flags: (1 << 0) | (1 << 2) | (1 << 3),
} as const;

/** What every member may do server-wide; channels narrow it down. No thread creation, no @everyone. */
export const everyonePermissions = bits(
  P.ViewChannel, P.CreateInstantInvite, P.ChangeNickname, P.SendMessages, P.SendMessagesInThreads,
  P.EmbedLinks, P.AttachFiles, P.AddReactions, P.UseExternalEmojis, P.UseExternalStickers,
  P.ReadMessageHistory, P.UseApplicationCommands, P.Connect, P.Speak, P.Stream, P.UseVAD,
);

export type RoleKey = 'team' | 'support';
export interface RoleSpec {
  readonly key: RoleKey;
  readonly name: string;
  readonly color: number;
  readonly permissions: string;
}

export const roles: readonly RoleSpec[] = [
  {
    key: 'team',
    name: 'Dealio Team',
    color: dealioBrand.colors.primary,
    permissions: bits(P.ManageMessages, P.ManageThreads, P.ModerateMembers, P.KickMembers, P.BanMembers,
      P.ManageNicknames, P.ViewAuditLog, P.MentionEveryone, P.ManageEvents, P.PinMessages),
  },
  {
    key: 'support',
    name: 'Support Team',
    color: dealioBrand.colors.accent,
    permissions: bits(P.ManageMessages, P.ManageThreads, P.ModerateMembers, P.ManageNicknames, P.ViewAuditLog, P.PinMessages),
  },
];

/** Who a channel rule is for: everyone, one of the roles above, or Dealio itself. */
export type Audience = 'everyone' | RoleKey | 'bot';
export interface OverwriteSpec { readonly audience: Audience; readonly allow?: string; readonly deny?: string }

export type ChannelKey =
  | 'welcome' | 'rules' | 'announcements' | 'faq'
  | 'general' | 'deals' | 'suggestions'
  | 'tickets'
  | 'ticketLog' | 'staffChat' | 'discordUpdates';

export interface ChannelSpec {
  readonly key: ChannelKey;
  readonly name: string;
  readonly type: ChannelType.GuildText | ChannelType.GuildAnnouncement | ChannelType.GuildForum;
  readonly topic: string;
  readonly overwrites: readonly OverwriteSpec[];
  readonly rateLimitPerUser?: number;
  /** Forum tags; `moderated` ones only the team can apply. */
  readonly tags?: readonly { readonly name: string; readonly emoji: string; readonly moderated?: boolean }[];
  readonly defaultReaction?: string;
}

export interface CategorySpec {
  readonly name: string;
  readonly overwrites: readonly OverwriteSpec[];
  readonly channels: readonly ChannelSpec[];
}

const staff: readonly RoleKey[] = ['team', 'support'];
const threadCreation = [P.CreatePublicThreads, P.CreatePrivateThreads];

/** Everyone reads; only the team and Dealio post. */
const readOnly: readonly OverwriteSpec[] = [
  { audience: 'everyone', allow: bits(P.ViewChannel, P.ReadMessageHistory), deny: bits(P.SendMessages, P.SendMessagesInThreads, ...threadCreation) },
  ...staff.map((audience): OverwriteSpec => ({ audience, allow: bits(P.SendMessages) })),
  { audience: 'bot', allow: bits(P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory) },
];

/** Hidden from members. */
const staffOnly: readonly OverwriteSpec[] = [
  { audience: 'everyone', deny: bits(P.ViewChannel) },
  ...staff.map((audience): OverwriteSpec => ({ audience, allow: bits(P.ViewChannel, P.SendMessages, P.ReadMessageHistory) })),
  { audience: 'bot', allow: bits(P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory) },
];

export const categories: readonly CategorySpec[] = [
  {
    name: '📌 Start Here',
    overwrites: readOnly,
    channels: [
      { key: 'welcome', name: '👋・welcome', type: ChannelType.GuildText, topic: 'What Dealio is and where to find everything.', overwrites: readOnly },
      { key: 'rules', name: '📜・rules', type: ChannelType.GuildText, topic: 'The server rules. Being here means you agree to them.', overwrites: readOnly },
      { key: 'announcements', name: '📣・announcements', type: ChannelType.GuildAnnouncement, topic: 'Releases, new features and service status. Follow it to get updates in your own server.', overwrites: readOnly },
      { key: 'faq', name: '❓・faq', type: ChannelType.GuildText, topic: 'Quick answers to the most common questions.', overwrites: readOnly },
    ],
  },
  {
    name: '💬 Community',
    overwrites: [],
    channels: [
      { key: 'general', name: '💬・general', type: ChannelType.GuildText, topic: 'Chat about Dealio, Steam and games. For account problems, open a ticket instead.', overwrites: [] },
      {
        key: 'deals', name: '🔥・deals', type: ChannelType.GuildText, rateLimitPerUser: 30, overwrites: [],
        topic: 'Share great Steam deals you caught. Store links only: no referral, key-reseller or affiliate links.',
      },
      {
        key: 'suggestions', name: '💡・suggestions', type: ChannelType.GuildForum, rateLimitPerUser: 600, defaultReaction: '👍',
        overwrites: [{ audience: 'bot', allow: bits(P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory) }],
        topic: 'One idea per post. Search first and 👍 existing ideas instead of reposting. Tell us the problem the idea solves; the team tags each post with its status.',
        tags: [
          { name: 'Feature', emoji: '✨' },
          { name: 'Improvement', emoji: '🛠️' },
          { name: 'Under review', emoji: '👀', moderated: true },
          { name: 'Planned', emoji: '🗓️', moderated: true },
          { name: 'Done', emoji: '✅', moderated: true },
          { name: 'Declined', emoji: '❌', moderated: true },
        ],
      },
    ],
  },
  {
    name: '🎫 Support',
    overwrites: [],
    channels: [
      {
        key: 'tickets', name: '🎫・open-a-ticket', type: ChannelType.GuildText,
        topic: 'Press "Open a ticket" for private help from the Dealio team.',
        overwrites: [
          // Members only use the button, but they must be able to write in their own private thread.
          { audience: 'everyone', allow: bits(P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads, P.AttachFiles, P.EmbedLinks),
            deny: bits(P.SendMessages, P.AddReactions, ...threadCreation) },
          // Members with Manage Threads see every private thread in the channel.
          ...staff.map((audience): OverwriteSpec => ({ audience, allow: bits(P.ViewChannel, P.SendMessagesInThreads, P.ManageThreads) })),
          { audience: 'bot', allow: bits(P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.CreatePrivateThreads,
            P.ManageThreads, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory) },
        ],
      },
    ],
  },
  {
    name: '🔒 Staff',
    overwrites: staffOnly,
    channels: [
      {
        key: 'ticketLog', name: '📋・ticket-log', type: ChannelType.GuildText, topic: 'Dealio posts every opened and closed ticket here.',
        // Dealio pings the Support Team role here without making it mentionable by everyone.
        overwrites: [...staffOnly, { audience: 'bot', allow: bits(P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.MentionEveryone) }],
      },
      { key: 'staffChat', name: '🛡️・staff-chat', type: ChannelType.GuildText, topic: 'Team talk. AutoMod alerts land here too.', overwrites: staffOnly },
      { key: 'discordUpdates', name: '🔔・discord-updates', type: ChannelType.GuildText, topic: 'Discord sends Community server notices here.', overwrites: staffOnly },
    ],
  },
];

/** Discord's own starter channels in a new server; they are replaced by the layout above. */
export const starterChannels = [
  // Channels first: a category is removed only once it is empty.
  { name: 'general', type: ChannelType.GuildText },
  { name: 'General', type: ChannelType.GuildVoice },
  { name: 'Text Channels', type: ChannelType.GuildCategory },
  { name: 'Voice Channels', type: ChannelType.GuildCategory },
] as const;

export const welcomeScreen = (channel: (key: ChannelKey) => string) => ({
  enabled: true,
  description: 'Help, updates and deal talk for Dealio, your Steam wishlist deal assistant.',
  welcome_channels: [
    { channel_id: channel('rules'), description: 'Read the rules first', emoji_name: '📜' },
    { channel_id: channel('faq'), description: 'Quick answers', emoji_name: '❓' },
    { channel_id: channel('tickets'), description: 'Private help from the team', emoji_name: '🎫' },
    { channel_id: channel('announcements'), description: 'Releases and status', emoji_name: '📣' },
    { channel_id: channel('deals'), description: 'Share Steam deals you caught', emoji_name: '🔥' },
  ],
});

/** AutoMod: block spam, mention raids, slurs and server invites; alert the team in staff chat. */
export const autoModerationRules = (ids: { readonly staffChat: string; readonly staffRoles: readonly string[] }) => {
  const alert = { type: 2, metadata: { channel_id: ids.staffChat } };
  return [
    { name: 'Dealio · Spam', event_type: 1, trigger_type: 3, actions: [{ type: 1 }, alert] },
    {
      name: 'Dealio · Mention spam', event_type: 1, trigger_type: 5,
      trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
      actions: [{ type: 1 }, { type: 3, metadata: { duration_seconds: 600 } }, alert],
      exempt_roles: ids.staffRoles,
    },
    {
      name: 'Dealio · Harmful words', event_type: 1, trigger_type: 4,
      // Sexual content and slurs. Gaming talk keeps its everyday swearing.
      trigger_metadata: { presets: [2, 3] },
      actions: [{ type: 1 }, alert],
    },
    {
      name: 'Dealio · Invite links', event_type: 1, trigger_type: 1,
      trigger_metadata: { regex_patterns: ['(?:discord\\.gg|discord(?:app)?\\.com/invite)/\\S+'] },
      actions: [{ type: 1, metadata: { custom_message: 'Server invites aren’t allowed here. Questions? Open a ticket.' } }, alert],
      exempt_roles: ids.staffRoles,
    },
  ];
};

// ---------------------------------------------------------------------------------
// Messages Dealio keeps in the info channels.

export const bannerFileName = 'dealio-banner.png';

export interface InfoMessage {
  readonly channel: ChannelKey;
  readonly container: ContainerBuilder;
  /** Uploaded with the message (the banner). */
  readonly files?: readonly string[];
}

const kicker = (emoji: string, label: string) => `-# ${emoji} DEALIO · ${label.toUpperCase()}`;
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const footerLine = '-# Dealio is free and independent: not affiliated with Valve, Steam or Discord.';

function done(container: ContainerBuilder): ContainerBuilder {
  container.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));
  assertComponentsV2Limit([container]);
  return container;
}

function welcome(clientId: string, channel: (key: ChannelKey) => string): ContainerBuilder {
  const c = (key: ChannelKey) => `<#${channel(key)}>`;
  return done(new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.primary)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${bannerFileName}`).setDescription('Dealio'),
    ))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${kicker('👋', 'Welcome')}\n# Welcome to Dealio!\n`
        + 'Dealio follows your **public Steam wishlist** and sends you a DM when a game hits **your** rule: '
        + 'a discount you pick, or a target price per game. No Steam password, no channel spam, '
        + 'and it speaks English, Turkish, German and French.'),
      new TextDisplayBuilder().setContent('### Get started in a minute\n'
        + '**1.** Add Dealio to a server or to your apps with the button below.\n'
        + '**2.** Run `/dealio` and paste your Steam profile link. Your profile and game details must be public.\n'
        + '**3.** Pick your Steam Store country and your discount rule. Done: deals come to your DMs.'),
      new TextDisplayBuilder().setContent('### Find your way around\n'
        + `📜 ${c('rules')} · please read them first\n`
        + `❓ ${c('faq')} · quick answers\n`
        + `🎫 ${c('tickets')} · private help from the team\n`
        + `📣 ${c('announcements')} · releases and status\n`
        + `💡 ${c('suggestions')} · ideas for Dealio\n`
        + `🔥 ${c('deals')} · share what you caught`),
    )
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(links.invite(clientId)).setEmoji('➕').setLabel('Add Dealio'),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(links.website).setEmoji('🌐').setLabel('Website'),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(links.help).setEmoji('📖').setLabel('Help center'),
    ))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# [Privacy policy](${links.privacy}) · [Terms](${links.terms}) · [Source code](${links.github})`)));
}

const ruleList = [
  ['Be kind', 'Respect everyone. No harassment, hate speech, discrimination or personal attacks.'],
  ['Keep it safe for work', 'No NSFW, gore or shocking content, in messages, names or avatars.'],
  ['No spam or ads', 'No unsolicited promotion, server invites, referral or affiliate links, here or in members’ DMs.'],
  ['Protect your accounts', 'Never share passwords, tokens or login codes. The Dealio team will never ask for them, and never DMs you first.'],
  ['No piracy or shady trading', 'No cracks, cheats, account trading or grey-market key reselling.'],
  ['Use the right place', `Account problems go in a ticket, ideas in suggestions, deals in deals. Please write in English in public channels.`],
  ['Follow Discord’s rules', `Discord’s [Terms of Service](${links.discordTerms}) and [Community Guidelines](${links.discordGuidelines}) apply here.`],
] as const;

function rules(channel: (key: ChannelKey) => string): ContainerBuilder {
  return done(new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.warning)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${kicker('📜', 'Rules')}\n# Server rules\nShort and simple, so this stays a friendly place to get help.`),
      new TextDisplayBuilder().setContent(ruleList.map(([title, text], index) => `**${index + 1}. ${title}**\n${text}`).join('\n\n')),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      'The team may remove messages, time out or remove members who break these rules. '
      + `If you disagree with a moderation decision, open a ticket in <#${channel('tickets')}>.`)));
}

const faqList: readonly (readonly [string, string])[] = [
  ['How do I start?', 'Run `/dealio`, paste your Steam profile link (or custom URL name, or SteamID64), then pick your Steam Store country and your discount rule. Dealio shows your Steam name and region before saving anything.'],
  ['Does Dealio need my Steam password?', 'No, never. It only reads your **public** wishlist. In Steam’s privacy settings, your profile and “Game details” must be public.'],
  ['When do I get a DM?', 'Dealio checks about every 30 minutes and right after Steam’s daily price change (10:00 Pacific). You get a DM when a game goes on sale and meets your rule, or reaches your target price. During the same sale it alerts again only if the deal gets clearly better.'],
  ['I didn’t get an alert', 'Open `/dealio` → 🔔 Alerts and check the history: quiet hours or a daily digest may be holding it. Make sure Discord allows DMs from Dealio, send a Test DM from ⚙️ Settings, and press Resume tracking if tracking was paused.'],
  ['Why is the price in another currency?', 'Prices follow the Steam Store country you picked, exactly as Steam shows them; Dealio never converts currencies. Change the country in ⚙️ Settings.'],
  ['What does “Coming soon”, “not sold” or “removed” mean?', 'The game has no price yet, isn’t sold in your Store country, or was removed from Steam. These never count as errors.'],
  ['My panel stopped responding', 'Panels close after a while for safety. Run `/dealio` again; tracking keeps running in the background.'],
  ['How do I delete my data?', 'Run `/delete-data` (or ⚙️ Settings → Delete my data). It removes your setup, rules, history and support tickets from Dealio.'],
  ['Is Dealio free?', 'Yes, completely. If you’d like to support it, there’s a ☕ button on the Home panel.'],
];

function faq(channel: (key: ChannelKey) => string): ContainerBuilder {
  return done(new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.success)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${kicker('❓', 'FAQ')}\n# Frequently asked questions`),
      new TextDisplayBuilder().setContent(faqList.map(([question, answer]) => `**${question}**\n${answer}`).join('\n\n')),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Still stuck? Open a ticket in <#${channel('tickets')}> and the team will help you privately.`))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(links.help).setEmoji('📖').setLabel('Full help center'),
    )));
}

export function infoMessages(clientId: string, channel: (key: ChannelKey) => string, bannerPath: string): InfoMessage[] {
  return [
    { channel: 'welcome', container: welcome(clientId, channel), files: [bannerPath] },
    { channel: 'rules', container: rules(channel) },
    { channel: 'faq', container: faq(channel) },
    { channel: 'tickets', container: buildSupportPanel('en', { faqChannelId: channel('faq') }) },
  ];
}
