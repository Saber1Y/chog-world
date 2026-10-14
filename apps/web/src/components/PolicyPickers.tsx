"use client";

import { Goal, GOAL_LABELS, POLICY_PRESETS, type GoalKey, type PolicyPresetKey } from "@chog-world/shared";
import { chog as fmtChog } from "@/lib/format";

export const GOAL_KEYS = Object.keys(Goal) as GoalKey[];
export const PRESET_KEYS = Object.keys(POLICY_PRESETS) as PolicyPresetKey[];

/** The preset an onchain policy matches, if any (owners may have set custom limits elsewhere). */
export function presetOf(policy: { dailyCap: string; maxPerAction: string; maxActionsPerDay: number }): PolicyPresetKey | null {
  return (
    PRESET_KEYS.find((k) => {
      const p = POLICY_PRESETS[k];
      return p.dailyCap.toString() === policy.dailyCap && p.maxPerAction.toString() === policy.maxPerAction && p.maxActionsPerDay === policy.maxActionsPerDay;
    }) ?? null
  );
}

export function GoalPicker({ value, onChange }: { value: number; onChange: (mask: number) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">It should…</legend>
      <div className="flex flex-wrap gap-2">
        {GOAL_KEYS.map((k) => {
          const on = (value & Goal[k]) !== 0;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(value ^ Goal[k])}
              className={`rounded-full border-[3px] border-ink px-4 py-2 text-sm font-bold transition-[transform,background-color,color] duration-150 active:scale-[0.97] ${
                on ? "bg-monad text-paper shadow-[3px_3px_0_0_var(--ink)]" : "bg-night text-muted hover:text-paper"
              }`}
            >
              {GOAL_LABELS[k]}
            </button>
          );
        })}
      </div>
      {value === 0 && <p className="mt-2 text-xs text-muted">No goals: it will balance everything.</p>}
    </fieldset>
  );
}

export function PresetPicker({ value, onChange, name = "preset" }: { value: PolicyPresetKey | null; onChange: (k: PolicyPresetKey) => void; name?: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Daily budget</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {PRESET_KEYS.map((k) => {
          const v = POLICY_PRESETS[k];
          const on = k === value;
          return (
            <label
              key={k}
              className={`cursor-pointer rounded-2xl border-[3px] border-ink p-4 transition-transform duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-gold ${
                on ? "-translate-y-0.5 bg-gold text-ink shadow-[4px_4px_0_0_var(--ink)]" : "bg-night hover:-translate-y-0.5"
              }`}
            >
              <input type="radio" name={name} value={k} checked={on} onChange={() => onChange(k)} className="sr-only" />
              <span className="font-display text-xl">{v.label}</span>
              <span className={`mt-1 block text-sm ${on ? "text-ink/80" : "text-muted"}`}>
                {fmtChog(v.dailyCap)} CHOG a day
                <br />
                up to {fmtChog(v.maxPerAction)} per move, {v.maxActionsPerDay} moves
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
