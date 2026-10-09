/**
 * Builds the Dealio support server in an existing, empty server (bots cannot create
 * one) through Discord's REST API with Dealio's token. It never opens a gateway
 * connection, so it does not compete with the running bot.
 *
 *   npm run support:setup -- --guild <server id> [--dry-run]
 *
 * Dealio needs Administrator in that server while this runs (docs/support-server.tr.md).
 * Everything is found by name, so running it again updates instead of duplicating.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  ChannelType, MessageFlags, OverwriteType, REST, Routes, SnowflakeUtil,
  type APIChannel, type APIGuild, type APIGuildForumTag, type APIExtendedInvite, type APIInvite, type APIMessage, type APIRole, type APIUser,
  type RESTPostAPIGuildChannelJSONBody,
} from 'discord.js';
import {
  autoModerationRules, bannerFileName, categories, impersonationKeywords, onboardingDefaultChannels, onboardingPrompts, ownerRoles, everyonePermissions, guildSettings, infoMessages, roles, starterChannels,
  welcomeScreen, type Audience, type ChannelKey, type ChannelSpec, type OverwriteSpec, type RoleKey,
} from './support-server/blueprint.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const guildId = option('--guild');
loadDotenv({ path: option('--env') ?? '.env' });
const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.DISCORD_CLIENT_ID?.trim();
if (!guildId || !/^\d{17,20}$/.test(guildId)) throw new Error('Pass the support server ID: --guild <id>');
if (!token || !clientId) throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be set (in .env or --env <file>)');

const rest = new REST({ version: '10', timeout: 20_000 }).setToken(token);
const bannerPath = resolve('docs/assets/dealio-onboarding-banner.png');
let placeholder = 0;

/** Every change goes through here: printed always, skipped with --dry-run. */
async function change<T>(description: string, run: () => Promise<T>, dryValue: T): Promise<T> {
  console.log(`${dryRun ? '[dry-run] ' : ''}${description}`);
  return dryRun ? dryValue : run();
}
const fakeId = () => `dry-run-${++placeholder}`;

const me = await rest.get(Routes.user()) as APIUser;
const guild = await rest.get(Routes.guild(guildId)).catch((error: unknown) => {
  throw new Error(`Dealio cannot read server ${guildId}. Is it in the server? (${String(error)})`);
}) as APIGuild;
console.log(`Setting up "${guild.name}" as ${me.username}${dryRun ? ' (dry run, nothing changes)' : ''}\n`);

// --- Server profile -------------------------------------------------------------------
let icon: string | undefined;
if (!guild.icon && me.avatar) {
  const response = await fetch(`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=512`, { signal: AbortSignal.timeout(15_000) });
  if (response.ok) icon = `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}
await change('Server name, icon, verification, content filter and notification defaults', () => rest.patch(Routes.guild(guildId), {
  body: {
    name: guildSettings.name,
    ...(icon ? { icon } : {}),
    verification_level: guildSettings.verification_level,
    explicit_content_filter: guildSettings.explicit_content_filter,
    default_message_notifications: guildSettings.default_message_notifications,
    preferred_locale: guildSettings.preferred_locale,
  },
  reason: 'Dealio support server setup',
}), undefined);

// --- Roles ------------------------------------------------------------------------------
const existingRoles = await rest.get(Routes.guildRoles(guildId)) as APIRole[];
const roleIds = {} as Partial<Record<RoleKey, string>>;
const enhancedColors = guild.features.includes('ENHANCED_ROLE_COLORS' as never);
const roleIcons = guild.features.includes('ROLE_ICONS' as never);
for (const spec of roles) {
  const body = {
    name: spec.name,
    color: spec.color,
    // Gradients and icons need boost level 2; until then the colour and the emoji in the name carry the look.
    ...(enhancedColors && spec.gradient ? { colors: { primary_color: spec.gradient[0], secondary_color: spec.gradient[1] } } : {}),
    ...(roleIcons ? { unicode_emoji: spec.icon } : {}),
    hoist: spec.hoist ?? true,
    mentionable: false,
    ...(spec.managedBooster ? {} : { permissions: spec.permissions }),
  };
  const existing = spec.managedBooster
    ? existingRoles.find((role) => role.tags?.premium_subscriber !== undefined)
    : existingRoles.find((role) => role.name === spec.name || spec.aliases?.includes(role.name));
  if (existing) {
    const renamed = existing.name !== spec.name ? ` (was ${existing.name})` : '';
    await change(`Update role ${spec.name}${renamed}`, () => rest.patch(Routes.guildRole(guildId, existing.id), { body }), undefined);
    roleIds[spec.key] = existing.id;
  } else if (spec.managedBooster) {
    console.log(`Skip ${spec.name}: Discord creates it with the server's first boost; run this again afterwards to style it`);
  } else {
    const created = await change(`Create role ${spec.name}`,
      () => rest.post(Routes.guildRoles(guildId), { body }) as Promise<APIRole>, { id: fakeId() } as APIRole);
    roleIds[spec.key] = created.id;
  }
}
const roleId = (key: RoleKey): string | undefined => roleIds[key];

// Order: Dealio on top, then the list above. Dealio cannot raise its own role, so it is
// only included when it already outranks everything it has to move.
const botRole = existingRoles.find((role) => role.tags?.bot_id === clientId);
const ordered = roles.flatMap((spec) => roleIds[spec.key] ? [roleIds[spec.key]!] : []);
if (!dryRun) {
  const positions = ordered.map((id, index) => ({ id, position: ordered.length - index }));
  await rest.patch(Routes.guildRoles(guildId), {
    body: botRole ? [{ id: botRole.id, position: ordered.length + 1 }, ...positions] : positions,
    reason: 'Dealio support server setup',
  }).then(() => console.log('Order roles: Dealio, then staff, boosters and donators'))
    .catch(async () => rest.patch(Routes.guildRoles(guildId), { body: positions }).then(
      () => console.log('Order roles below Dealio'),
      (error: unknown) => console.warn(`  Could not order roles (${String(error)}). Drag the Dealio role to the top in Server Settings → Roles and run this again.`),
    ));
} else {
  console.log('[dry-run] Order roles: Dealio, then staff, boosters and donators');
}

// The owner wears the crown and receives the ticket pings.
for (const key of ownerRoles) {
  const id = roleIds[key];
  if (!id) continue;
  await change(`Give the server owner ${roles.find((spec) => spec.key === key)!.name}`,
    () => rest.put(Routes.guildMemberRole(guildId, guild.owner_id, id), { reason: 'Dealio support server setup' }), undefined)
    .catch((error: unknown) => console.warn(`  Could not give the owner a role (${String(error)})`));
}
await change('Set what @everyone may do server-wide (no thread creation, no @everyone pings)',
  () => rest.patch(Routes.guildRole(guildId, guildId), { body: { permissions: everyonePermissions } }), undefined);

// --- Channels ---------------------------------------------------------------------------
let channels = await rest.get(Routes.guildChannels(guildId)) as APIChannel[];
const channelIds = {} as Record<ChannelKey, string>;
const channelId = (key: ChannelKey): string => channelIds[key];

function overwrites(specs: readonly OverwriteSpec[]) {
  const target = (audience: Audience) => audience === 'everyone' ? { id: guildId!, type: OverwriteType.Role }
    : audience === 'bot' ? { id: me.id, type: OverwriteType.Member }
    : { id: roleIds[audience], type: OverwriteType.Role };
  // A role that does not exist yet (Server Booster before the first boost) gets its rule on a later run.
  return specs.filter((spec) => spec.audience === 'everyone' || spec.audience === 'bot' || roleIds[spec.audience])
    .map((spec) => ({ ...target(spec.audience) as { id: string; type: OverwriteType }, allow: spec.allow ?? '0', deny: spec.deny ?? '0' }));
}

function forumTags(spec: ChannelSpec, current?: readonly APIGuildForumTag[]) {
  // Keep existing tag IDs, so posts keep their tags when this runs again.
  return spec.tags?.map((tag) => ({
    ...(current?.find((existing) => existing.name === tag.name)?.id ? { id: current.find((existing) => existing.name === tag.name)!.id } : {}),
    name: tag.name, emoji_name: tag.emoji, moderated: tag.moderated ?? false,
  }));
}

/** Text channels a type-change can convert: an announcements channel starts as text until Community is on. */
async function ensureChannel(spec: ChannelSpec, parentId: string, position: number, community: boolean): Promise<void> {
  const type = spec.type === ChannelType.GuildAnnouncement && !community ? ChannelType.GuildText : spec.type;
  const existing = channels.find((channel) => channel.name === spec.name && channel.type !== ChannelType.GuildCategory);
  const body = {
    name: spec.name,
    type,
    topic: spec.topic,
    parent_id: parentId,
    position,
    permission_overwrites: overwrites(spec.overwrites),
    ...(spec.rateLimitPerUser !== undefined ? { rate_limit_per_user: spec.rateLimitPerUser } : {}),
    ...(spec.tags ? { available_tags: forumTags(spec, existing && 'available_tags' in existing ? existing.available_tags : undefined) } : {}),
    ...(spec.defaultReaction ? { default_reaction_emoji: { emoji_name: spec.defaultReaction } } : {}),
    ...(spec.gallery ? { default_forum_layout: 2 } : {}),
  };
  if (existing) {
    const { type: _type, ...update } = body;
    const convert = existing.type !== type && type === ChannelType.GuildAnnouncement;
    await change(`Update #${spec.name}${convert ? ' (now an announcement channel)' : ''}`,
      () => rest.patch(Routes.channel(existing.id), { body: convert ? { ...update, type } : update }), undefined);
    channelIds[spec.key] = existing.id;
  } else {
    const created = await change(`Create #${spec.name}`,
      () => rest.post(Routes.guildChannels(guildId!), { body: body as RESTPostAPIGuildChannelJSONBody }) as Promise<APIChannel>,
      { id: fakeId() } as APIChannel);
    channelIds[spec.key] = created.id;
    channels = [...channels, created];
  }
}

async function buildChannels(community: boolean): Promise<void> {
  let position = 0;
  for (const category of categories) {
    const existing = channels.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === category.name);
    let categoryId: string;
    const body = { name: category.name, type: ChannelType.GuildCategory, position: position++, permission_overwrites: overwrites(category.overwrites) };
    if (existing) {
      await change(`Update category ${category.name}`, () => rest.patch(Routes.channel(existing.id), { body: { ...body, type: undefined } }), undefined);
      categoryId = existing.id;
    } else {
      const created = await change(`Create category ${category.name}`,
        () => rest.post(Routes.guildChannels(guildId!), { body }) as Promise<APIChannel>, { id: fakeId() } as APIChannel);
      categoryId = created.id;
      channels = [...channels, created];
    }
    for (const [index, spec] of category.channels.entries()) await ensureChannel(spec, categoryId, index, community);
  }
}

const communityOn = guild.features.includes('COMMUNITY' as never);
await buildChannels(communityOn);

// --- Community, announcements and the welcome screen -----------------------------------
if (!communityOn) {
  await change('Turn on Community (rules and Discord-updates channels, required for App Directory)', () => rest.patch(Routes.guild(guildId), {
    body: {
      features: [...new Set([...guild.features, 'COMMUNITY'])],
      rules_channel_id: channelId('rules'),
      public_updates_channel_id: channelId('discordUpdates'),
      safety_alerts_channel_id: channelId('discordUpdates'),
      verification_level: guildSettings.verification_level,
      explicit_content_filter: guildSettings.explicit_content_filter,
    },
    reason: 'Dealio support server setup',
  }), undefined);
  // Announcement channels exist only in Community servers.
  const announcements = categories.flatMap((category) => category.channels).find((spec) => spec.key === 'announcements')!;
  const parent = channels.find((channel) => channel.id === channelId('announcements')) as { parent_id?: string | null } | undefined;
  await ensureChannel(announcements, parent?.parent_id ?? '', 2, true);
}
await change('Server description, system channel and rules/updates channels', () => rest.patch(Routes.guild(guildId), {
  body: {
    description: guildSettings.description,
    system_channel_id: channelId('general'),
    system_channel_flags: guildSettings.system_channel_flags,
    rules_channel_id: channelId('rules'),
    public_updates_channel_id: channelId('discordUpdates'),
  },
}), undefined);
await change('Welcome screen', () => rest.patch(Routes.guildWelcomeScreen(guildId), { body: welcomeScreen(channelId) }), undefined);

// --- Discord's starter channels ---------------------------------------------------------
/** Only join notices and other system messages: nobody has talked there. */
async function unused(channel: APIChannel): Promise<boolean> {
  if (channel.type === ChannelType.GuildCategory) {
    return !channels.some((candidate) => 'parent_id' in candidate && candidate.parent_id === channel.id);
  }
  if (channel.type !== ChannelType.GuildText) return true;
  const messages = await rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: '50' }) }) as APIMessage[];
  return messages.every((message) => ![0, 19, 20, 23].includes(message.type));
}
for (const starter of starterChannels) {
  const channel = channels.find((candidate) => candidate.name === starter.name && candidate.type === starter.type);
  if (!channel || Object.values(channelIds).includes(channel.id)) continue;
  if (!dryRun && !await unused(channel)) {
    console.log(`Keep Discord's starter channel "${starter.name}": it is in use`);
    continue;
  }
  await change(`Remove Discord's starter channel "${starter.name}"`, () => rest.delete(Routes.channel(channel.id)), undefined);
  channels = channels.filter((candidate) => candidate.id !== channel.id);
}

// --- AutoMod ----------------------------------------------------------------------------
const existingRules = dryRun ? [] : await rest.get(Routes.guildAutoModerationRules(guildId)) as Array<{ id: string; name: string }>;
for (const rule of autoModerationRules({ staffChat: channelId('staffChat'), staffRoles: (['owner', 'admins', 'moderators', 'support'] as const).flatMap((key) => roleIds[key] ? [roleIds[key]!] : []) })) {
  const existing = existingRules.find((candidate) => candidate.name === rule.name);
  await change(`${existing ? 'Update' : 'Create'} AutoMod rule "${rule.name}"`, () => existing
    ? rest.patch(Routes.guildAutoModerationRule(guildId, existing.id), { body: { ...rule, trigger_type: undefined, enabled: true } })
    : rest.post(Routes.guildAutoModerationRules(guildId), { body: { ...rule, enabled: true } }), undefined)
    .catch((error: unknown) => console.warn(`  AutoMod rule "${rule.name}" skipped: ${String(error)}`));
}

const profileRuleName = 'Dealio · Staff impersonation';
const profileRule = {
  name: profileRuleName, event_type: 2, trigger_type: 6, enabled: true,
  trigger_metadata: { keyword_filter: impersonationKeywords },
  // Blocks chatting and reacting until the name changes; Discord tells the member why.
  actions: [{ type: 4 }],
  exempt_roles: (['owner', 'admins', 'moderators', 'support'] as const).flatMap((key) => roleIds[key] ? [roleIds[key]!] : []),
};
const existingProfileRule = existingRules.find((candidate) => candidate.name === profileRuleName);
await change(`${existingProfileRule ? 'Update' : 'Create'} AutoMod rule "${profileRuleName}" (names posing as staff)`, () => existingProfileRule
  ? rest.patch(Routes.guildAutoModerationRule(guildId, existingProfileRule.id), { body: { ...profileRule, trigger_type: undefined } })
  : rest.post(Routes.guildAutoModerationRules(guildId), { body: profileRule }), undefined)
  .catch((error: unknown) => console.warn(`  AutoMod rule "${profileRuleName}" skipped: ${String(error)}`));

// --- Custom emoji -----------------------------------------------------------------------
const emojis = dryRun ? [] : await rest.get(Routes.guildEmojis(guildId)) as Array<{ name: string }>;
if (!emojis.some((emoji) => emoji.name === 'dealio') && me.avatar) {
  const avatar = await fetch(`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`, { signal: AbortSignal.timeout(15_000) });
  if (avatar.ok) {
    const image = `data:image/png;base64,${Buffer.from(await avatar.arrayBuffer()).toString('base64')}`;
    await change('Create the :dealio: emoji', () => rest.post(Routes.guildEmojis(guildId), { body: { name: 'dealio', image } }), undefined)
      .catch((error: unknown) => console.warn(`  :dealio: emoji skipped: ${String(error)}`));
  }
}

// --- Onboarding -------------------------------------------------------------------------
// Prompt and option IDs are kept by title, so members' earlier answers stay valid.
const currentOnboarding = dryRun ? { prompts: [] } : await rest.get(Routes.guildOnboarding(guildId)) as {
  prompts: Array<{ id: string; title: string; options: Array<{ id: string; title: string }> }>;
};
const onboarding = {
  enabled: true,
  mode: 0,
  default_channel_ids: onboardingDefaultChannels.map(channelId),
  prompts: onboardingPrompts.map((prompt) => {
    const current = currentOnboarding.prompts.find((candidate) => candidate.title === prompt.title);
    return {
      id: current?.id ?? SnowflakeUtil.generate().toString(),
      type: 0,
      title: prompt.title,
      single_select: prompt.singleSelect,
      required: false,
      in_onboarding: true,
      options: prompt.options.map((option) => ({
        id: current?.options.find((candidate) => candidate.title === option.title)?.id ?? SnowflakeUtil.generate().toString(),
        title: option.title,
        description: option.description,
        emoji: { name: option.emoji },
        channel_ids: (option.channels ?? []).map(channelId),
        role_ids: (option.roles ?? []).flatMap((key) => roleIds[key] ? [roleIds[key]!] : []),
      })),
    };
  }),
};
await change('Onboarding: default channels, "What brings you here?" and the Updates ping opt-in',
  () => rest.put(Routes.guildOnboarding(guildId), { body: onboarding }), undefined)
  .catch((error: unknown) => console.warn(`  Onboarding skipped: ${String(error)}`));

// --- Info messages ----------------------------------------------------------------------
for (const message of infoMessages(clientId, channelId, bannerPath, roleId)) {
  const target = channelId(message.channel);
  const files = (message.files ?? []).map((path) => ({ name: path === bannerPath ? bannerFileName : basename(path), data: readFileSync(path) }));
  const body = {
    flags: MessageFlags.IsComponentsV2,
    components: [message.container.toJSON()],
    allowed_mentions: { parse: [] },
    attachments: files.map((file, id) => ({ id, filename: file.name })),
  };
  const recent = dryRun ? [] : await rest.get(Routes.channelMessages(target), { query: new URLSearchParams({ limit: '20' }) }) as APIMessage[];
  const own = recent.find((candidate) => candidate.author.id === me.id);
  await change(`${own ? 'Update' : 'Post'} the ${message.channel} message`, () => own
    ? rest.patch(Routes.channelMessage(target, own.id), { body, files })
    : rest.post(Routes.channelMessages(target), { body, files }), undefined);
}

// --- Invite -----------------------------------------------------------------------------
const invites = dryRun ? [] : await rest.get(Routes.guildInvites(guildId)) as APIExtendedInvite[];
let invite: APIInvite | undefined = invites.find((candidate) => candidate.inviter?.id === me.id && !candidate.max_age && candidate.channel?.id === channelId('welcome'));
invite ??= await change('Create a permanent invite to #welcome', () => rest.post(Routes.channelInvites(channelId('welcome')), {
  body: { max_age: 0, max_uses: 0, unique: false },
}) as Promise<APIInvite>, { code: 'dry-run' } as APIInvite);

console.log(`
Done. Next steps (docs/support-server.tr.md):
  1. Hand out the staff and Donator roles in Server Settings → Members.
  2. Set these on the VM's .env and restart Dealio, so the ticket button works:
       DEALIO_SUPPORT_GUILD_ID=${guildId}
       DEALIO_SUPPORT_LOG_CHANNEL_ID=${channelId('ticketLog')}
       DEALIO_SUPPORT_TEAM_ROLE_ID=${roleIds.support ?? ''}
  3. Support server invite for the Developer Portal and top.gg: https://discord.gg/${invite.code}
`);
