"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { simulate, ELEMENTS, type Stats } from "@chog-world/shared";
import type { Battle, ChogRef } from "@/lib/api";
import { chog as fmtChog } from "@/lib/format";
import { explorerTx } from "@/lib/config";
import { ChogImage } from "./ChogImage";
import { ELEMENT_STYLE } from "./Stats";

const SPEEDS = [1, 2, 4] as const;
const BASE_MS = 700;

/**
 * Replays a resolved battle hit by hit. Nothing here comes from the server except the seed and the
 * two stat lines: the browser re-runs the same engine as the contract, and the result is checked
 * against the onchain logHash.
 */
export function BattleReplay({ battle }: { battle: Battle }) {
  const replay = useMemo(() => {
    if (!battle.attStats || !battle.defStats || !battle.seed) return null;
    return simulate(battle.attStats, battle.defStats, battle.seed);
  }, [battle.attStats, battle.defStats, battle.seed]);

  const verified = !!replay && replay.logHash === battle.logHash && replay.aWins === battle.attackerWon;
  const total = replay?.hits.length ?? 0;
  const [step, setStep] = useState(0); // hits shown so far
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  // Restart whenever a different battle is selected.
  useEffect(() => {
    setStep(0);
    setPlaying(true);
  }, [battle.battleId]);

  useEffect(() => {
    if (!playing || step >= total) return;
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / speed);
    return () => clearTimeout(t);
  }, [playing, step, total, speed]);

  if (battle.status !== "resolved") {
    return (
      <div className="sticker grid min-h-72 place-items-center bg-night-2 p-8 text-center">
        <p className="font-display text-2xl">{battle.status === "voided" ? "Voided: fee refunded" : "Fighting… the result lands in a couple of blocks"}</p>
      </div>
    );
  }
  if (!replay || !battle.attStats || !battle.defStats) {
    return (
      <div className="sticker grid min-h-72 place-items-center bg-night-2 p-8 text-center text-muted">
        This battle&apos;s replay data is not available, but its result is final onchain.
      </div>
    );
  }

  const last = step > 0 ? replay.hits[step - 1]! : null;
  const hpA = last ? last.hpA : battle.attStats.hp;
  const hpB = last ? last.hpB : battle.defStats.hp;
  const done = step >= total;
  const attackerWon = replay.aWins;
  const txUrl = battle.resolveTx ? explorerTx(battle.resolveTx) : null;

  return (
    <section className="sticker overflow-hidden bg-night-2" aria-label={`Replay of battle ${battle.battleId}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-ink px-5 py-3">
        <p className="font-display text-xl">
          Battle #{battle.battleId} · {fmtChog(battle.fee)} CHOG
        </p>
        <span
          className={`rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${verified ? "border-mint/60 bg-mint/15 text-mint" : "border-danger/60 bg-danger/15 text-danger"}`}
          title={verified ? "This replay reproduces the onchain result exactly (logHash matches)." : "The replay does not match the onchain logHash."}
        >
          {verified ? "✓ verified against chain" : "replay mismatch"}
        </span>
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 p-5 sm:gap-6">
        <Fighter
          who={battle.attacker}
          role="Attacker"
          stats={battle.attStats}
          hp={hpA}
          beingHit={!!last && !last.attackerIsA}
          attacking={!!last && last.attackerIsA}
          side="left"
          hitKey={step}
          lastHit={last && !last.attackerIsA ? last : null}
          result={done ? (attackerWon ? "win" : "loss") : null}
        />
        <div className="grid h-full place-items-center pt-16">
          <span className="font-display text-3xl text-gold sm:text-4xl">VS</span>
        </div>
        <Fighter
          who={battle.defender}
          role="Defender"
          stats={battle.defStats}
          hp={hpB}
          beingHit={!!last && last.attackerIsA}
          attacking={!!last && !last.attackerIsA}
          side="right"
          hitKey={step}
          lastHit={last && last.attackerIsA ? last : null}
          result={done ? (attackerWon ? "loss" : "win") : null}
        />
      </div>

      <div className="border-t-[3px] border-ink px-5 py-4">
        <p className="min-h-6 text-sm" aria-live="polite">
          {!last && "Fighters ready…"}
          {last && !done && <HitLine hit={last} battle={battle} />}
          {done && (
            <span className="font-bold">
              {name(attackerWon ? battle.attacker : battle.defender)} wins in {replay.rounds} round{replay.rounds === 1 ? "" : "s"}
              {battle.repDelta ? ` · +${battle.repDelta} rep` : ""}
              {battle.payout && BigInt(battle.payout) > 0n ? ` · paid ${fmtChog(battle.payout)} CHOG` : ""}
            </span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ControlButton onClick={() => (done ? (setStep(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {done ? "Replay" : playing ? "Pause" : "Play"}
          </ControlButton>
          <ControlButton onClick={() => setStep(total)} disabled={done}>
            Skip to end
          </ControlButton>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`rounded-lg px-2.5 py-1 text-sm font-bold transition-transform active:scale-[0.97] ${speed === s ? "bg-monad text-paper" : "text-muted hover:text-paper"}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <span className="w-full text-xs text-muted sm:w-auto">
            Hit {Math.min(step, total)} of {total}
            {txUrl && (
              <>
                {" · "}
                <a href={txUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                  settlement tx
                </a>
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

function name(c: ChogRef | null): string {
  return c ? (c.nickname ?? `Chog #${c.tokenId}`) : "Unknown Chog";
}

function HitLine({ hit, battle }: { hit: { attackerIsA: boolean; damage: number; crit: boolean; advantage: boolean; round: number }; battle: Battle }) {
  const att = hit.attackerIsA ? battle.attacker : battle.defender;
  const def = hit.attackerIsA ? battle.defender : battle.attacker;
  const attEl = hit.attackerIsA ? battle.attStats!.element : battle.defStats!.element;
  const defEl = hit.attackerIsA ? battle.defStats!.element : battle.attStats!.element;
  return (
    <span>
      <span className="text-muted">Round {hit.round}: </span>
      <span className="font-bold">{name(att)}</span> hits <span className="font-bold">{name(def)}</span> for{" "}
      <span className="font-bold text-gold">{hit.damage}</span>
      {hit.crit && <span className="ml-1 font-bold text-danger">CRIT!</span>}
      {hit.advantage && (
        <span className="ml-1 text-muted">
          ({ELEMENTS[attEl]} beats {ELEMENTS[defEl]})
        </span>
      )}
    </span>
  );
}

function ControlButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-xl border-[3px] border-ink bg-night-3 px-3.5 py-1.5 text-sm font-bold shadow-[3px_3px_0_0_var(--ink)] transition-transform active:scale-[0.97] disabled:opacity-40"
    />
  );
}

function Fighter({
  who,
  role,
  stats,
  hp,
  beingHit,
  attacking,
  side,
  hitKey,
  lastHit,
  result,
}: {
  who: ChogRef | null;
  role: string;
  stats: Stats;
  hp: number;
  beingHit: boolean;
  attacking: boolean;
  side: "left" | "right";
  hitKey: number;
  lastHit: { damage: number; crit: boolean } | null;
  result: "win" | "loss" | null;
}) {
  const frac = Math.max(0, hp / stats.hp);
  const el = ELEMENT_STYLE[stats.element % 4]!;
  const motion = beingHit ? "hit-shake" : attacking ? (side === "left" ? "lunge-right" : "lunge-left") : "";
  return (
    <div className="min-w-0 text-center">
      <p className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">{role}</p>
      <div className="relative">
        {/* key restarts the shake/lunge on every hit */}
        <div key={`${hitKey}-${side}`} className={motion}>
          <div className={`sticker overflow-hidden transition-opacity duration-300 ${result === "loss" ? "opacity-40 grayscale" : ""}`}>
            {who ? <ChogImage tokenId={who.tokenId} size={256} /> : <div className="aspect-square bg-night-3" />}
          </div>
        </div>
        {lastHit && (
          <span
            key={`dmg-${hitKey}`}
            className={`dmg-pop pointer-events-none absolute left-1/2 top-1/3 font-display drop-shadow-[2px_2px_0_var(--ink)] ${lastHit.crit ? "text-4xl text-danger" : "text-3xl text-paper"}`}
            aria-hidden
          >
            −{lastHit.damage}
          </span>
        )}
        {result === "win" && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-ink bg-gold px-3 py-0.5 font-display text-sm text-ink shadow-[2px_2px_0_0_var(--ink)]">
            WINNER
          </span>
        )}
      </div>
      {who ? (
        <Link href={`/chog/${who.tokenId}`} className="mt-2 block truncate font-display text-lg hover:text-gold">
          {name(who)}
        </Link>
      ) : (
        <p className="mt-2 font-display text-lg">?</p>
      )}
      <div className="mt-1 flex items-center justify-center gap-1.5 text-xs">
        <span className="rounded-full border-2 border-ink px-1.5 font-bold text-ink" style={{ background: el.color }}>
          {el.name}
        </span>
        <span className="font-mono text-muted">
          {hp}/{stats.hp}
        </span>
      </div>
      <div
        className="mt-2 h-4 overflow-hidden rounded-full border-[3px] border-ink bg-night"
        role="meter"
        aria-label={`${name(who)} health`}
        aria-valuenow={hp}
        aria-valuemin={0}
        aria-valuemax={stats.hp}
      >
        <div
          className="hp-fill h-full w-full"
          style={{ transform: `scaleX(${frac})`, backgroundColor: frac > 0.5 ? "var(--mint)" : frac > 0.2 ? "var(--gold)" : "var(--danger)" }}
        />
      </div>
    </div>
  );
}
