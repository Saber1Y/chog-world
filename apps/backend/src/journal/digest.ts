import { and, desc, eq, gte } from "drizzle-orm";
import type { Database } from "../database/db.js";
import { digests } from "../database/schema.js";
import type { Journal, JournalRow } from "./journal.js";
import type { TextModel } from "../llm/models.js";

export type DigestRow = typeof digests.$inferSelect;

/** Minimum gap between generated digests for one Chog, so page reloads never spend tokens. */
const MIN_GAP_MS = 30 * 60_000;
const MAX_ROWS = 80;

export const DIGEST_SYSTEM = `You write the "While you were away" note for a Chog's owner in CHOG World.
You get the Chog's journal entries since the owner last looked, oldest first. Each entry is a fact that happened onchain.

Write 2 to 4 short sentences in the Chog's voice, first person, playful but honest.
- Mention only things in the entries. Never invent events, numbers, names or outcomes.
- Lead with what matters most: titles, level-ups, rivalries, big wins or losses, money earned, being stopped by policy.
- Plain text only: no lists, no headings, no emoji.`;

/** A digest written from journal rows only. A language model narrates; facts come exclusively from the rows. */
export class Digests {
  constructor(
    private readonly db: Database,
    private readonly journal: Journal,
    private readonly llm: TextModel | null,
  ) {}

  async latest(chogKey: string): Promise<DigestRow | undefined> {
    const [row] = await this.db.select().from(digests).where(eq(digests.chogKey, chogKey)).orderBy(desc(digests.id)).limit(1);
    return row;
  }

  /**
   * The digest covering `since` until now. Returns the recent one if it is fresh enough, writes a
   * new one when there is something new to say, and returns undefined when nothing happened.
   */
  async forVisit(chogKey: string, since: Date): Promise<DigestRow | undefined> {
    const recent = await this.db
      .select()
      .from(digests)
      .where(and(eq(digests.chogKey, chogKey), gte(digests.createdAt, new Date(Date.now() - MIN_GAP_MS))))
      .orderBy(desc(digests.id))
      .limit(1);
    if (recent[0]) return recent[0];

    const rows = (await this.journal.since(chogKey, since)).filter((r) => r.kind !== "thought").slice(-MAX_ROWS);
    if (rows.length === 0) return undefined;

    const { text, writtenBy } = await this.write(rows);
    const [row] = await this.db
      .insert(digests)
      .values({ chogKey, fromTime: since, toTime: new Date(), text, writtenBy })
      .returning();
    return row;
  }

  private async write(rows: JournalRow[]): Promise<{ text: string; writtenBy: "llm" | "template" }> {
    if (this.llm) {
      try {
        const facts = rows.map((r) => `- ${r.createdAt.toISOString().slice(0, 16).replace("T", " ")}: ${r.title}${r.body ? ` (${r.body})` : ""}`).join("\n");
        const text = await this.llm.text({ system: DIGEST_SYSTEM, user: `Journal entries:\n${facts}`, maxTokens: 1_500 });
        return { text: text.slice(0, 800), writtenBy: "llm" };
      } catch {
        // Fall through to the template: the digest is a nicety and must never fail the page.
      }
    }
    return { text: templateDigest(rows), writtenBy: "template" };
  }
}

/** Deterministic digest: counts plus the most notable lines. */
export function templateDigest(rows: JournalRow[]): string {
  const quests = rows.filter((r) => r.kind === "quest" && !r.title.startsWith("Set out")).length;
  const battles = rows.filter((r) => r.kind === "battle" && /^(Beat|Lost|Held)/.test(r.title)).length;
  const notable = rows.filter((r) => r.kind === "title" || r.kind === "level" || r.title.includes("rivalry")).map((r) => r.title);
  const parts = [`While you were away I finished ${quests} quest${quests === 1 ? "" : "s"} and fought ${battles} battle${battles === 1 ? "" : "s"}.`];
  if (notable.length) parts.push(`${notable.slice(-3).join(". ")}.`);
  // Only real blocks: owner actions (new goals, pause, enrollment) are also "policy" rows.
  if (rows.some((r) => r.kind === "policy" && r.title.startsWith("Stopped by policy"))) parts.push("Your policy stepped in at least once.");
  return parts.join(" ");
}
