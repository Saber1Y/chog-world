import { describe, expect, it } from "vitest";
import { templateDigest } from "../src/journal/digest.js";
import type { JournalRow } from "../src/journal/journal.js";

function row(kind: string, title: string): JournalRow {
  return { id: 1, chogKey: "0x1", kind, title, body: null, data: null, txHash: null, blockNumber: null, sourceKey: title, createdAt: new Date(0) } as JournalRow;
}

describe("templateDigest", () => {
  it("counts finished quests and fights, and lists the notable moments", () => {
    const text = templateDigest([
      row("quest", "Set out for Slime Pit"),
      row("quest", "Cleared Slime Pit: +20 XP"),
      row("battle", "Challenged Chog #2 for 10 CHOG"),
      row("battle", "Beat Chog #2 in the Arena (+15 rep)"),
      row("level", "Reached level 3"),
    ]);
    expect(text).toBe("While you were away I finished 1 quest and fought 1 battle. Reached level 3.");
  });

  it("mentions the policy only when it actually blocked a move", () => {
    expect(templateDigest([row("policy", "Owner set new goals"), row("policy", "Owner paused the agent")])).not.toContain("policy");
    expect(templateDigest([row("policy", "Stopped by policy: daily cap reached")])).toContain("Your policy stepped in");
  });
});
