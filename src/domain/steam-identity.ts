export type SteamIdentityErrorCode =
  | 'STEAM_PROFILE_INVALID'
  | 'STEAM_VANITY_NOT_FOUND'
  | 'STEAM_VANITY_UNAVAILABLE'
  | 'STEAM_WEB_API_KEY_MISSING'
  | 'STEAM_IDENTITY_CANCELLED';

export class SteamIdentityError extends Error {
  public readonly name = 'SteamIdentityError';

  public constructor(public readonly code: SteamIdentityErrorCode, message: string) {
    super(message);
  }
}
