"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const DAY_MS = 24 * 3_600_000;

function storageKey(tokenId: string): string {
  return `chogworld:seen:${tokenId}`;
}

function readSeen(tokenId: string): string | null {
  try {
    return localStorage.getItem(storageKey(tokenId));
  } catch {
    return null;
  }
}

function writeSeen(tokenId: string, iso: string): void {
  try {
    localStorage.setItem(storageKey(tokenId), iso);
  } catch {
    // Private mode or blocked storage: the next visit simply covers the last day again.
  }
}

function sinceLabel(iso: string): string {
  const d = new Date(iso);
  const hours = Math.round((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 1) return "in the last hour";
  if (hours < 24) return `in the last ${hours} hours`;
  return `since ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
}

/**
 * "While you were away": the Chog's own short summary of what happened since its owner last opened
 * this page (or the last day, on a first visit). Facts come only from its journal; when nothing
 * happened the card stays hidden.
 */
export function AwayDigest({ tokenId, name }: { tokenId: string; name: string }) {
  const [since, setSince] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Read the previous visit before recording this one, so the summary covers the gap between them.
    const previous = readSeen(tokenId);
    setSince(previous ?? new Date(Date.now() - DAY_MS).toISOString());
    writeSeen(tokenId, new Date().toISOString());
  }, [tokenId]);

  const digest = useQuery({
    queryKey: ["digest", tokenId, since],
    queryFn: () => api.digest(tokenId, since!),
    enabled: since !== null,
    staleTime: Infinity,
    retry: false,
  });

  if (dismissed || !digest.data) return null;
  return (
    <section className="sticker animate-pop-in relative bg-night-2 p-5" aria-labelledby="away-title">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-night-3 hover:text-paper"
      >
        ×
      </button>
      <p className="text-xs font-bold uppercase tracking-widest text-gold">While you were away</p>
      <h2 id="away-title" className="sr-only">
        While you were away
      </h2>
      <blockquote className="mt-2 pr-6 text-lg leading-relaxed text-paper">&ldquo;{digest.data.text}&rdquo;</blockquote>
      <p className="mt-3 text-sm text-muted">
        {name}, {sinceLabel(digest.data.fromTime)}
        {digest.data.writtenBy === "template" ? " · summary" : ""}
      </p>
    </section>
  );
}
