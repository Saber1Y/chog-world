/** Signed profile updates expire after this long, so a leaked signature cannot be replayed later. */
export const PROFILE_MAX_AGE_MS = 10 * 60_000;
export const NICKNAME_MAX = 40;
export const PERSONALITY_MAX = 140;

/** Collapse whitespace and strip control characters. Applied before signing and before verifying. */
export function normalizeProfileText(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The exact text an owner signs to set their Chog's nickname and personality. The web app signs it
 * and the backend rebuilds it to verify, so both must use this function with normalized fields.
 */
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

/**
 * The exact text an owner signs to set (or clear, with `target` null) the Chog their Chog holds a
 * grudge against. Built the same way by the web app and the backend.
 */
export function grudgeMessage(p: { chainId: number; tokenId: bigint; target: bigint | null; issuedAt: string }): string {
  return [
    "CHOG World: set my Chog's grudge",
    `Chain: ${p.chainId}`,
    `Chog: #${p.tokenId}`,
    `Grudge against: ${p.target === null ? "nobody" : `#${p.target}`}`,
    `Issued: ${p.issuedAt}`,
  ].join("\n");
}
