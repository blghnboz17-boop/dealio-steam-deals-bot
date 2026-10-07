/**
 * Interactions the bot already refused (a blocked account). Discord delivers every
 * interaction to all listeners, so an open panel's collector would otherwise still
 * act on a click the block notice answered.
 */
const refused = new WeakSet<object>();

export function refuseInteraction(interaction: object): void {
  refused.add(interaction);
}

export function isRefusedInteraction(interaction: object): boolean {
  return refused.has(interaction);
}

/** A panel's own user, and not a click Dealio refused: the check every panel collector makes. */
export function isFromUser(interaction: { readonly user: { readonly id: string } }, userId: string): boolean {
  return interaction.user.id === userId && !refused.has(interaction);
}
