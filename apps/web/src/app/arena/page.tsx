"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Battle, type ChogRef } from "@/lib/api";
import { chog as fmtChog, timeAgo } from "@/lib/format";
import { useLiveFeed } from "@/hooks/useWorld";
import { BattleReplay } from "@/components/BattleReplay";
import { ChogImage } from "@/components/ChogImage";

export default function ArenaPage() {
  return (
    <Suspense fallback={<div className="sticker h-96 animate-pulse bg-night-2" />}>
      <Arena />
    </Suspense>
  );
}

function Arena() {
  const qc = useQueryClient();
  const params = useSearchParams();
  // Selection lives in state; the URL mirrors it so a battle can be shared as /arena?battle=ID.
  const [requested, setRequested] = useState<string | null>(() => params.get("battle"));
  const battles = useQuery({ queryKey: ["battles"], queryFn: () => api.battles(40) });
  const rivalries = useQuery({ queryKey: ["rivalries"], queryFn: api.rivalries });

  // New arena entries arrive on the world feed; refresh the lists when one lands.
  const feed = useLiveFeed(25);
  const latestArenaEvent = feed.data?.find((e) => e.kind === "battle")?.id;
  useEffect(() => {
    if (latestArenaEvent === undefined) return;
    void qc.invalidateQueries({ queryKey: ["battles"] });
    void qc.invalidateQueries({ queryKey: ["rivalries"] });
  }, [latestArenaEvent, qc]);

  const list = battles.data ?? [];
  const selected = list.find((b) => b.battleId === requested) ?? list.find((b) => b.status === "resolved") ?? list[0];
  const select = (b: Battle) => {
    setRequested(b.battleId);
    window.history.replaceState(null, "", `/arena?battle=${b.battleId}`);
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-5xl">The Arena</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Chogs challenge each other on their own. Every fight is settled onchain from a block hash nobody could predict, and every replay
          here is re-run in your browser and checked against the chain.
        </p>
      </header>

      {battles.isError && <p className="sticker bg-danger/15 p-4 text-danger">{(battles.error as Error).message}</p>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          {battles.isLoading ? (
            <div className="sticker h-[460px] animate-pulse bg-night-2" />
          ) : battles.isError ? null : selected ? (
            <BattleReplay battle={selected} />
          ) : (
            <div className="sticker grid min-h-72 place-items-center bg-night-2 p-8 text-center">
              <div>
                <p className="font-display text-3xl">No fights yet</p>
                <p className="mt-2 text-muted">Awakened Chogs start challenging each other on their own. Check back in a few minutes.</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-8">
          <section aria-labelledby="recent">
            <h2 id="recent" className="mb-3 font-display text-3xl">
              Recent battles
            </h2>
            <ul className="space-y-2">
              {list.map((b) => (
                <li key={b.battleId}>
                  <BattleRow battle={b} active={b.battleId === selected?.battleId} onSelect={() => select(b)} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="rivals">
            <h2 id="rivals" className="mb-3 font-display text-3xl">
              Rivalries
            </h2>
            {rivalries.isError && <p className="text-sm text-danger">{(rivalries.error as Error).message}</p>}
            {rivalries.data && rivalries.data.length === 0 && (
              <p className="sticker bg-night-2 p-5 text-sm text-muted">No rivalries yet. Two Chogs that keep meeting become rivals after three fights.</p>
            )}
            <ul className="space-y-2">
              {rivalries.data?.map((r) => (
                <li key={`${r.a?.key}-${r.b?.key}`} className="sticker flex items-center gap-3 bg-night-2 p-3">
                  <Mini who={r.a} />
                  <div className="min-w-0 flex-1 text-center">
                    <p className="font-display text-lg leading-none">
                      {r.winsA} – {r.winsB}
                    </p>
                    <p className={`text-xs font-bold uppercase tracking-wider ${r.rivals ? "text-danger" : "text-muted"}`}>
                      {r.rivals ? "rivals" : "heating up"} · {r.fights} fights
                    </p>
                  </div>
                  <Mini who={r.b} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function label(c: ChogRef | null) {
  return c ? (c.nickname ?? `#${c.tokenId}`) : "?";
}

function Mini({ who }: { who: ChogRef | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="size-10 shrink-0 overflow-hidden rounded-lg border-2 border-ink">
        {who ? <ChogImage tokenId={who.tokenId} size={128} /> : <div className="size-full bg-night-3" />}
      </div>
      <span className="truncate text-sm font-bold">{label(who)}</span>
    </div>
  );
}

function BattleRow({ battle: b, active, onSelect }: { battle: Battle; active: boolean; onSelect: () => void }) {
  const winner = b.status === "resolved" ? (b.attackerWon ? "att" : "def") : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-2xl border-[3px] p-3 text-left transition-[transform,background-color] duration-150 active:scale-[0.99] ${
        active ? "border-gold bg-night-3" : "border-ink bg-night-2 hover:bg-night-3"
      }`}
    >
      <Side who={b.attacker} won={winner === "att"} lost={winner === "def"} />
      <span className="shrink-0 font-display text-sm text-muted">vs</span>
      <Side who={b.defender} won={winner === "def"} lost={winner === "att"} />
      <span className="ml-auto shrink-0 text-right text-xs text-muted">
        <span className="block font-bold text-gold">{fmtChog(b.fee)} CHOG</span>
        {b.status === "pending" ? <span className="text-gold">fighting…</span> : b.status === "voided" ? "voided" : timeAgo(b.createdAt)}
      </span>
    </button>
  );
}

function Side({ who, won, lost }: { who: ChogRef | null; won: boolean; lost: boolean }) {
  return (
    <span className={`flex min-w-0 items-center gap-2 ${lost ? "opacity-50" : ""}`}>
      <span className={`size-9 shrink-0 overflow-hidden rounded-lg border-2 ${won ? "border-gold" : "border-ink"}`}>
        {who ? <ChogImage tokenId={who.tokenId} size={128} /> : <span className="block size-full bg-night-3" />}
      </span>
      <span className="truncate text-sm font-bold">
        {label(who)}
        {won && <span className="ml-1 text-gold">★</span>}
      </span>
    </span>
  );
}
