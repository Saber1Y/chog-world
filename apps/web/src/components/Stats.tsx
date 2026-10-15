import { baseStats, dnaOf, ELEMENTS, hueOf, type Stats } from "@chog-world/shared";
import type { Address } from "viem";

export const ELEMENT_STYLE = [
  { name: ELEMENTS[0], color: "#ff5a1f", beats: ELEMENTS[1] },
  { name: ELEMENTS[1], color: "#2fbf5b", beats: ELEMENTS[2] },
  { name: ELEMENTS[2], color: "#f2d518", beats: ELEMENTS[3] },
  { name: ELEMENTS[3], color: "#1f8bff", beats: ELEMENTS[0] },
] as const;

export function dnaFor(collection: Address, tokenId: string) {
  const d = dnaOf(collection, BigInt(tokenId));
  return { stats: baseStats(d), hue: hueOf(d) };
}

const ROWS: { key: keyof Stats; label: string; max: number }[] = [
  { key: "hp", label: "HP", max: 160 },
  { key: "atk", label: "ATK", max: 40 },
  { key: "def", label: "DEF", max: 30 },
  { key: "spd", label: "SPD", max: 25 },
  { key: "crit", label: "CRIT", max: 20 },
];

/** Compact stat bars. `base` (optional) shows how much came from progression. */
export function StatBars({ stats, base, accent = "var(--chog)" }: { stats: Stats; base?: Stats; accent?: string }) {
  return (
    <dl className="space-y-1.5">
      {ROWS.map((r) => {
        const v = stats[r.key];
        const b = base ? base[r.key] : v;
        return (
          <div key={r.key} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-2 text-sm">
            <dt className="font-bold text-muted">{r.label}</dt>
            <dd className="relative h-3 overflow-hidden rounded-full border-2 border-ink bg-night">
              <span className="absolute inset-y-0 left-0 rounded-full bg-paper/35" style={{ width: `${Math.min(100, (v / r.max) * 100)}%` }} />
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (b / r.max) * 100)}%`, background: accent }} />
            </dd>
            <dd className="text-right font-mono text-xs tabular-nums">
              {v}
              {r.key === "crit" ? "%" : ""}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function ElementBadge({ element }: { element: number }) {
  const e = ELEMENT_STYLE[element % 4]!;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold text-ink"
      style={{ background: e.color }}
      title={`${e.name} element: born with it, strong against ${e.beats}`}
    >
      {e.name} element
    </span>
  );
}
