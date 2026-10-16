"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLiveFeed } from "@/hooks/useWorld";
import { ChogImage } from "@/components/ChogImage";
import { FeedItem } from "@/components/Feed";

const STEPS = [
  { n: "1", title: "Awaken it", body: "Give your Chog its own wallet, a few goals and a daily budget. Three signatures." },
  { n: "2", title: "It lives", body: "A few times a day it decides what to do: quest, fight, shop or rest. All onchain, all inside your limits." },
  { n: "3", title: "It becomes someone", body: "Levels, scars, gear, titles and rivals. Sell it and everything it earned goes with it." },
];

export default function Home() {
  const feed = useLiveFeed(25);
  const top = useQuery({ queryKey: ["leaderboard", "level"], queryFn: () => api.leaderboard("level") });
  const stars = (top.data ?? []).slice(0, 3);

  return (
    <div className="space-y-20">
      <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="mb-4 inline-block rounded-full border-2 border-monad/60 bg-monad/15 px-3 py-1 text-sm font-semibold text-monad">
            Chogathon 2026 · on Monad
          </p>
          <h1 className="font-display text-5xl leading-[0.95] sm:text-7xl">
            Every Chog has a look. Now give it a <span className="text-gold">life.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Awaken your Chog, hand it goals and a budget, and it quests, fights and earns on its own. Its levels, titles, scars and rivals become
            part of it, and everything it earns moves with the NFT until it is unmistakably <em className="not-italic text-paper">someone</em>.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/chogs" className="sticker press bg-gold px-6 py-3 font-display text-xl text-ink">
              Awaken your Chog
            </Link>
            <a href="#world" className="sticker press bg-night-3 px-6 py-3 font-display text-xl">
              Watch the world
            </a>
          </div>
        </div>

        <div className="relative mx-auto h-[360px] w-full max-w-md sm:h-[420px]" aria-label="Evolved Chogs">
          {[0, 1, 2].map((i) => {
            // The top Chog takes the raised centre card, the runners-up flank it.
            const s = stars[[1, 0, 2][i]!];
            const pos = ["left-0 top-10 -rotate-6", "left-1/2 top-0 z-10 -translate-x-1/2 rotate-1", "right-0 top-16 rotate-6"][i];
            const open = !s && top.isSuccess;
            return (
              <div key={i} className={`absolute w-[58%] ${pos} ${i === 1 ? "animate-float" : ""}`}>
                {open ? (
                  <Link href="/chogs" className="sticker press block overflow-hidden bg-night-2">
                    <div className="grid aspect-square place-items-center bg-night-3 font-display text-7xl text-muted/50">?</div>
                    <div className="border-t-[3px] border-ink px-3 py-2 text-sm font-bold text-gold">Your Chog here</div>
                  </Link>
                ) : (
                  <div className="sticker overflow-hidden bg-night-2">
                    {s ? <ChogImage tokenId={s.tokenId} size={384} /> : <div className="aspect-square animate-pulse bg-night-3" />}
                    <div className="flex items-center justify-between border-t-[3px] border-ink px-3 py-2 text-sm">
                      <span className="font-bold">{s ? (s.nickname ?? `#${s.tokenId}`) : "…"}</span>
                      {s && <span className="font-display text-gold">LV {s.level}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="how" className="relative">
        <h2 id="how" className="sr-only">How it works</h2>
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.n} className={`sticker bg-night-2 p-6 ${["md:-rotate-1", "md:translate-y-4", "md:rotate-1"][i]}`}>
              <span className="sticker mb-4 grid size-11 place-items-center bg-monad font-display text-2xl">{s.n}</span>
              <h3 className="font-display text-2xl">{s.title}</h3>
              <p className="mt-2 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="world" aria-labelledby="world-title" className="scroll-mt-24">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="world-title" className="font-display text-4xl">
            Right now in CHOG World
          </h2>
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-mint" />
            </span>
            live
          </span>
        </div>
        <div className="sticker bg-night-2 px-5">
          {feed.isLoading && <p className="py-8 text-center text-muted">Listening to the world…</p>}
          {feed.isError && <p className="py-8 text-center text-danger">{(feed.error as Error).message}</p>}
          {feed.data && feed.data.length === 0 && (
            <p className="py-8 text-center text-muted">Quiet so far. Be the first to awaken a Chog.</p>
          )}
          {feed.data && feed.data.length > 0 && (
            <ul className="divide-y-2 divide-night-3">
              {feed.data.map((e) => (
                <FeedItem key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
