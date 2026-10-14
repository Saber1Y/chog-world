"use client";

import { useEffect, useRef, useState } from "react";
import { chogImageUrl } from "@/lib/api";

/** The evolved Chog, rendered by the backend. Shows a shimmer while loading and a fallback on error. */
export function ChogImage({
  tokenId,
  size = 512,
  version,
  className = "",
  alt,
}: {
  tokenId: string;
  size?: number;
  version?: string | number;
  className?: string;
  alt?: string;
}) {
  const src = chogImageUrl(tokenId, size, version);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const img = useRef<HTMLImageElement>(null);

  // A cached image can finish before React attaches onLoad (it is in the server HTML), so check
  // on mount and whenever the source changes; a new source also clears an earlier error.
  useEffect(() => {
    const el = img.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "ok" : "error");
    else setState((prev) => (prev === "error" ? "loading" : prev));
  }, [src]);

  return (
    <div className={`relative aspect-square overflow-hidden bg-night-3 ${className}`}>
      {state === "loading" && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-night-3 to-night-2" aria-hidden />}
      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted">Chog #{tokenId} is hiding. Try again soon.</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic server render with ETag caching
        <img
          ref={img}
          src={src}
          alt={alt ?? `Chog #${tokenId}`}
          width={size}
          height={size}
          className={`size-full object-cover transition-opacity duration-300 ${state === "ok" ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
      )}
    </div>
  );
}
