"use client";

import { useState } from "react";
import { SITE_URL } from "@/lib/config";

/**
 * Share a Chog: post it on X (the link unfurls into its share card) or copy the link. Uses the
 * browser's own share sheet on phones when there is one.
 */
export function ShareChog({ tokenId, name, level, isOwner }: { tokenId: string; name: string; level: number; isOwner: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE_URL}/chog/${tokenId}`;
  const text = isOwner
    ? `My Chog ${name} is level ${level} and living on its own in CHOG World. Every Chog has a look; this one has a life.`
    : `${name} is level ${level} in CHOG World. Every Chog has a look; this one has a life.`;
  const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  async function copy() {
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${name} · CHOG World`, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // The share sheet was dismissed or the clipboard is unavailable: nothing to report.
    }
  }

  return (
    <div className="flex gap-2">
      <a
        href={xUrl}
        target="_blank"
        rel="noreferrer"
        className="sticker press flex-1 bg-paper py-2 text-center font-display text-base text-ink"
      >
        Share on X
      </a>
      <button type="button" onClick={copy} className="sticker press flex-1 bg-night-3 py-2 font-display text-base" aria-live="polite">
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}
