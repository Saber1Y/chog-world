"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { api, type OwnedChog } from "@/lib/api";
import { useWorldConfig } from "@/hooks/useWorld";
import { isLocalFork } from "@/lib/config";
import { ChogImage } from "@/components/ChogImage";
import { ElementBadge, StatBars, dnaFor } from "@/components/Stats";
import type { Address } from "viem";

export default function MyChogs() {
  const { address, isConnected } = useAccount();
  const config = useWorldConfig();
  const owned = useQuery({ queryKey: ["owned", address], queryFn: () => api.owned(address!), enabled: !!address });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Your Chogs</h1>
          <p className="mt-2 max-w-xl text-muted">Pick one to awaken. Every Chog has hidden DNA: the stats it was born with, before it does anything.</p>
        </div>
        <JumpToChog />
      </header>

      {!isConnected && (
        <div className="sticker grid place-items-center gap-4 bg-night-2 px-6 py-16 text-center">
          <p className="font-display text-3xl">Connect to find your Chogs</p>
          <p className="max-w-md text-muted">We look up which Chogs your wallet owns. Nothing is signed until you choose to awaken one.</p>
          <ConnectButton />
        </div>
      )}

      {isConnected && owned.isLoading && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sticker h-[480px] animate-pulse bg-night-2" />
          ))}
        </div>
      )}

      {owned.isError && <p className="sticker bg-danger/15 p-4 text-danger">{(owned.error as Error).message}</p>}

      {owned.data && owned.data.length === 0 && (
        <div className="sticker bg-night-2 px-6 py-14 text-center">
          <p className="font-display text-3xl">No Chogs in this wallet</p>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {isLocalFork
              ? "This is a local practice copy of the chain, so Chogs you own on real testnet don't appear here."
              : "Ownership refreshes every few minutes, so a Chog you just bought may take a moment to show up. You can also open one by its number above."}
          </p>
        </div>
      )}

      {owned.data && owned.data.length > 0 && config.data && (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {owned.data.map((c) => (
            <ChogCard key={c.tokenId} chog={c} collection={config.data.deployment.collection} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChogCard({ chog, collection }: { chog: OwnedChog; collection: Address }) {
  const { stats, hue } = dnaFor(collection, chog.tokenId);
  const accent = `hsl(${hue} 80% 58%)`;
  return (
    <li className="sticker animate-pop-in overflow-hidden bg-night-2" style={{ ["--chog" as string]: accent }}>
      <ChogImage tokenId={chog.tokenId} size={384} />
      <div className="space-y-4 border-t-[3px] border-ink p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-2xl">{chog.nickname ?? `Chog #${chog.tokenId}`}</h2>
          <ElementBadge element={stats.element} />
        </div>
        <StatBars stats={stats} accent={accent} />
        <Link
          href={`/chog/${chog.tokenId}`}
          className={`sticker press block py-2.5 text-center font-display text-lg ${chog.enrolled ? "bg-night-3" : "bg-gold text-ink"}`}
        >
          {chog.enrolled ? `Visit · LV ${chog.level}` : chog.awakened ? "Wake its agent" : "Awaken"}
        </Link>
      </div>
    </li>
  );
}

function JumpToChog() {
  const router = useRouter();
  const [id, setId] = useState("");
  const valid = /^\d{1,4}$/.test(id) && Number(id) > 0;
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/chog/${Number(id)}`);
      }}
    >
      <label htmlFor="jump" className="sr-only">
        Chog number
      </label>
      <input
        id="jump"
        inputMode="numeric"
        placeholder="Chog #"
        value={id}
        onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
        className="sticker w-28 bg-night-2 px-3 py-2 font-mono placeholder:text-muted"
      />
      <button type="submit" disabled={!valid} className="sticker press bg-night-3 px-4 py-2 font-bold disabled:opacity-40 disabled:hover:transform-none">
        Open
      </button>
    </form>
  );
}
