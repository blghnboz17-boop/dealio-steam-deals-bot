import { InteractionContextType, type Interaction } from 'discord.js';
import { safeLogger } from '../application/safe-logger.js';
import type {
  InstallType, InteractionContext, InteractionKind, InteractionRecord, TelemetryRepository,
} from '../persistence/telemetry-repository.js';

/**
 * A stable action name from a component ID: `assistant:<session>:page:2` becomes
 * `assistant:page:#`. Session tokens and numbers are dropped so actions group.
 */
export function componentAction(customId: string): string {
  const [prefix, ...rest] = customId.split(':');
  const parts = rest
    // Session IDs are interaction snowflakes or UUIDs.
    .filter((segment) => !/^\d{15,}$/.test(segment) && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment))
    .map((segment) => (/\d{2,}/.test(segment) ? '#' : segment))
    .slice(0, 3);
  return [prefix ?? '', ...parts].join(':').slice(0, 80);
}

export function interactionContext(context: InteractionContextType | null | undefined): InteractionContext {
  switch (context) {
    case InteractionContextType.Guild: return 'guild';
    case InteractionContextType.BotDM: return 'bot_dm';
    case InteractionContextType.PrivateChannel: return 'private_channel';
    default: return 'unknown';
  }
}

/** Discord lists the integration owners that authorized this interaction: "0" server, "1" user. */
export function installType(owners: Readonly<Partial<Record<0 | 1, string>>> | null | undefined): InstallType {
  const guild = owners?.[0] !== undefined;
  const user = owners?.[1] !== undefined;
  return guild && user ? 'both' : guild ? 'guild' : user ? 'user' : 'unknown';
}

export function interactionRecord(interaction: Interaction, now: Date = new Date()): InteractionRecord | null {
  let kind: InteractionKind;
  let action: string;
  if (interaction.isChatInputCommand()) {
    kind = 'command';
    const subcommand = interaction.options.getSubcommand(false);
    action = `/${interaction.commandName}${subcommand ? ` ${subcommand}` : ''}`;
  } else if (interaction.isMessageComponent()) {
    kind = 'component';
    action = componentAction(interaction.customId);
  } else if (interaction.isModalSubmit()) {
    kind = 'modal';
    action = componentAction(interaction.customId);
  } else {
    return null;
  }
  return {
    discordUserId: interaction.user.id,
    guildId: interaction.guildId ?? null,
    context: interactionContext(interaction.context),
    install: installType(interaction.authorizingIntegrationOwners),
    kind,
    action,
    locale: interaction.locale ?? null,
    occurredAt: now.toISOString(),
  };
}

/** Records one interaction; telemetry must never delay or break the reply. */
export function recordInteraction(telemetry: Pick<TelemetryRepository, 'recordInteraction'> | undefined,
  interaction: Interaction): void {
  if (!telemetry) return;
  try {
    const record = interactionRecord(interaction);
    if (record) telemetry.recordInteraction(record);
  } catch (error: unknown) {
    safeLogger.error('Could not record interaction telemetry', error);
  }
}
