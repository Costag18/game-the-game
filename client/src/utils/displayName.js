/**
 * Get display name for a player ID using nicknames map.
 * Falls back to first 8 chars of the ID.
 */
export function displayName(playerId, nicknames = {}) {
  return nicknames[playerId] || playerId?.slice(0, 8) || '?';
}
