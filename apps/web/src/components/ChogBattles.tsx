"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, type Battle } from "@/lib/api";
import { chog as fmtChog, timeAgo } from "@/lib/format";
import { ChogImage } from "./ChogImage";

/** This Chog's arena record, newest first, each linking to its replay. */
export function ChogBattles({ tokenId, chogKey }: { tokenId: string; chogKey: string }) {
  const battles = useQuery({ queryKey: ["chogBattles", tokenId], queryFn: () => api.chogBattles(tokenId), refetchInterval: 30_000 });

  return (
    <section className="sticker bg-night-2 p-5" aria-labelledby="battles-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="battles-title" className="font-display text-2xl">
          Battles
        </h2>
        <Link href="/arena" className="text-sm font-bold text-muted hover:text-paper">
          Arena →
        </Link>
      </div>
      {battles.isLoading && <div className="h-24 animate-pulse rounded-xl bg-night-3" />}
      {battles.isError && <p className="text-sm text-danger">{(battles.error as Error).message}</p>}
      {battles.data && battles.data.length === 0 && <p className="text-sm text-muted">No fights yet. Its agent picks fights it expects to win.</p>}
      {battles.data && battles.data.length > 0 && (
        <ul className="space-y-2">
          {battles.data.slice(0, 8).map((b) => (
            <li key={b.battleId}>
              <BattleLine battle={b} chogKey={chogKey} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BattleLine({ battle: b, chogKey }: { battle: Battle; chogKey: string }) {
  const attacking = b.attKey === chogKey;
  const opponent = attacking ? b.defender : b.attacker;
  const won = b.status === "resolved" ? (b.attackerWon === attacking) : null;
  const rep = b.repDelta ?? 0;
  const outcome =
    b.status === "pending" ? (
      <span className="text-gold">fighting…</span>
    ) : b.status === "voided" ? (
      <span className="text-muted">voided</span>
    ) : won ? (
      <span className="text-mint">Won · +{rep} rep</span>
    ) : (
      <span className="text-danger">Lost · −{Math.floor(rep / 2)} rep</span>
    );

  return (
    <Link
      href={`/arena?battle=${b.battleId}`}
      className="flex items-center gap-3 rounded-xl border-2 border-ink bg-night px-3 py-2 transition-colors hover:bg-night-3"
    >
      <span className="size-9 shrink-0 overflow-hidden rounded-lg border-2 border-ink">
        {opponent ? <ChogImage tokenId={opponent.tokenId} size={128} /> : <span className="block size-full bg-night-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">
          {attacking ? "Challenged" : "Defended vs"} {opponent ? (opponent.nickname ?? `#${opponent.tokenId}`) : "?"}
        </span>
        <span className="block text-xs">{outcome}</span>
      </span>
      <span className="shrink-0 text-right text-xs text-muted">
        <span className="block font-bold text-gold">{fmtChog(b.fee)}</span>
        {timeAgo(b.createdAt)}
      </span>
    </Link>
  );
}
