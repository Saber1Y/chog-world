"use client";

import Link from "next/link";
import type { JournalEntry } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/** Per-kind colour chip, so the feed scans at a glance. */
export const KIND_STYLE: Record<string, { label: string; className: string }> = {
  thought: { label: "thinks", className: "bg-monad/20 text-monad border-monad/50" },
  quest: { label: "quest", className: "bg-gold/15 text-gold border-gold/50" },
  battle: { label: "arena", className: "bg-danger/15 text-danger border-danger/50" },
  level: { label: "level up", className: "bg-mint/15 text-mint border-mint/50" },
  title: { label: "title", className: "bg-gold/25 text-gold border-gold" },
  scar: { label: "scar", className: "bg-danger/10 text-danger border-danger/40" },
  zone: { label: "explore", className: "bg-mint/10 text-mint border-mint/40" },
  item: { label: "shop", className: "bg-paper/10 text-paper border-paper/30" },
  economy: { label: "coins", className: "bg-gold/15 text-gold border-gold/50" },
  policy: { label: "owner", className: "bg-muted/10 text-muted border-muted/40" },
  life: { label: "life", className: "bg-monad/15 text-paper border-monad/40" },
};

export function KindChip({ kind }: { kind: string }) {
  const k = KIND_STYLE[kind] ?? { label: kind, className: "bg-paper/10 text-paper border-paper/30" };
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${k.className}`}>
      {k.label}
    </span>
  );
}

export function FeedItem({ entry, showChog = true }: { entry: JournalEntry; showChog?: boolean }) {
  const isThought = entry.kind === "thought";
  return (
    <li className="animate-pop-in flex items-start gap-3 py-3">
      <KindChip kind={entry.kind} />
      <div className="min-w-0 flex-1">
        <p className={`leading-snug ${isThought ? "italic text-paper/90" : "text-paper"}`}>
          {showChog && entry.tokenId && (
            <Link href={`/chog/${entry.tokenId}`} className="mr-1.5 font-bold text-gold hover:underline">
              {entry.nickname ?? `#${entry.tokenId}`}
            </Link>
          )}
          {isThought ? `“${entry.title}”` : entry.title}
        </p>
        {entry.body && !isThought && <p className="mt-0.5 text-sm text-muted">{entry.body}</p>}
      </div>
      <time className="shrink-0 pt-0.5 text-xs text-muted" dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
        {timeAgo(entry.createdAt)}
      </time>
    </li>
  );
}
