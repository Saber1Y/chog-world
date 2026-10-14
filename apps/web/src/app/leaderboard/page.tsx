"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { TITLE_LABELS } from "@chog-world/shared";
import { api, type LeaderRow } from "@/lib/api";
import { chog as fmtChog } from "@/lib/format";
import { ChogImage } from "@/components/ChogImage";

type Board = "rep" | "level" | "wins" | "earned";

const BOARDS: { id: Board; label: string; blurb: string }[] = [
  { id: "rep", label: "Reputation", blurb: "Earned in the Arena and out exploring." },
  { id: "level", label: "Level", blurb: "Who has grown the most." },
  { id: "wins", label: "Wins", blurb: "Arena victories, attacking or defending." },
  { id: "earned", label: "Earnings", blurb: "CHOG brought home from quests, bonuses and bounties." },
];

function score(r: LeaderRow, board: Board): string {
  switch (board) {
    case "rep":
      return `${r.rep} rep`;
    case "level":
      return `LV ${r.level}`;
    case "wins":
      return `${r.wins}W ${r.losses}L`;
    case "earned":
      return `${fmtChog(r.earned)} CHOG`;
  }
}

function titleCount(titles: number): number {
  return Object.keys(TITLE_LABELS).filter((bit) => (titles & (1 << Number(bit))) !== 0).length;
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("rep");
  const { address } = useAccount();
  const rows = useQuery({ queryKey: ["leaderboard", board], queryFn: () => api.leaderboard(board), refetchInterval: 20_000 });
  const owned = useQuery({ queryKey: ["owned", address], queryFn: () => api.owned(address!), enabled: !!address });
  const mine = new Set(owned.data?.map((c) => c.tokenId));
  const data = rows.data ?? [];
  const podium = data.slice(0, 3);
  const rest = data.slice(3);
  const blurb = BOARDS.find((b) => b.id === board)!.blurb;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Leaderboard</h1>
          <p className="mt-2 text-muted">{blurb}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-2xl border-[3px] border-ink bg-night-2 p-1" role="tablist" aria-label="Leaderboard">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={board === b.id}
              onClick={() => setBoard(b.id)}
              className={`rounded-xl px-3.5 py-2 text-sm font-bold transition-colors ${board === b.id ? "bg-gold text-ink" : "text-muted hover:text-paper"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </header>

      {rows.isError && <p className="sticker bg-danger/15 p-4 text-danger">{(rows.error as Error).message}</p>}
      {rows.isLoading && <div className="sticker h-80 animate-pulse bg-night-2" />}
      {rows.data && data.length === 0 && (
        <div className="sticker bg-night-2 p-10 text-center">
          <p className="font-display text-3xl">Nobody on the board yet</p>
          <Link href="/chogs" className="sticker press mt-5 inline-block bg-gold px-5 py-2 font-display text-lg text-ink">
            Awaken the first Chog
          </Link>
        </div>
      )}

      {podium.length > 0 && (
        <ol className="grid grid-cols-3 items-end gap-3 sm:gap-6" aria-label="Top three">
          {[1, 0, 2].map((i) => {
            const r = podium[i];
            if (!r) return <li key={i} />;
            const place = i + 1;
            const lift = place === 1 ? "sm:-translate-y-6" : "";
            return (
              <li key={r.tokenId} className={`animate-pop-in ${lift}`} style={{ animationDelay: `${place * 60}ms` }}>
                <Link
                  href={`/chog/${r.tokenId}`}
                  className={`sticker press block overflow-hidden bg-night-2 ${mine.has(r.tokenId) ? "ring-4 ring-monad" : ""}`}
                >
                  <ChogImage tokenId={r.tokenId} size={384} />
                  <div className="border-t-[3px] border-ink p-2 text-center sm:p-3">
                    <p className="flex items-center justify-center gap-2">
                      <span
                        aria-label={`Place ${place}`}
                        className={`grid size-7 shrink-0 place-items-center rounded-full border-[3px] border-ink font-display text-sm text-ink sm:size-8 sm:text-base ${
                          place === 1 ? "bg-gold" : place === 2 ? "bg-[#d9dde3]" : "bg-[#d8955a]"
                        }`}
                      >
                        {place}
                      </span>
                      <span className="truncate font-display text-base sm:text-xl">{r.nickname ?? `Chog #${r.tokenId}`}</span>
                    </p>
                    <p className="font-display text-sm text-gold sm:text-lg">{score(r, board)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {rest.length > 0 && (
        <ol className="sticker divide-y-2 divide-night-3 overflow-hidden bg-night-2" start={4}>
          {rest.map((r, i) => (
            <li key={r.tokenId}>
              <Link
                href={`/chog/${r.tokenId}`}
                className={`grid grid-cols-[2.5rem_2.75rem_1fr_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-night-3 ${mine.has(r.tokenId) ? "bg-monad/15" : ""}`}
              >
                <span className="text-center font-display text-lg text-muted">{i + 4}</span>
                <span className="size-11 overflow-hidden rounded-lg border-2 border-ink">
                  <ChogImage tokenId={r.tokenId} size={128} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">
                    {r.nickname ?? `Chog #${r.tokenId}`}
                    {mine.has(r.tokenId) && <span className="ml-2 rounded-full bg-monad px-2 py-0.5 text-[11px] text-paper">yours</span>}
                  </span>
                  <span className="text-xs text-muted">
                    LV {r.level} · {r.wins}W {r.losses}L{titleCount(r.titles) > 0 ? ` · ${titleCount(r.titles)} trophies` : ""}
                    {!r.enrolled && " · resting"}
                  </span>
                </span>
                <span className="font-display text-lg text-gold">{score(r, board)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
