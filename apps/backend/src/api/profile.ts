/** Signed profile updates expire after this long, so a leaked signature cannot be replayed later. */
export const PROFILE_MAX_AGE_MS = 10 * 60_000;

/** The exact text an owner signs to set their Chog's nickname and personality. Shared with the web app. */
export function profileMessage(p: {
  chainId: number;
  tokenId: bigint;
  nickname: string | null;
  personality: string | null;
  issuedAt: string;
}): string {
  return [
    "CHOG World: update my Chog's profile",
    `Chain: ${p.chainId}`,
    `Chog: #${p.tokenId}`,
    `Nickname: ${p.nickname ?? ""}`,
    `Personality: ${p.personality ?? ""}`,
    `Issued: ${p.issuedAt}`,
  ].join("\n");
}
