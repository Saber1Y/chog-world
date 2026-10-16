"use client";

import { useState } from "react";
import Link from "next/link";
import { useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Hex } from "viem";
import { grudgeMessage } from "@chog-world/shared";
import { api, type ChogView } from "@/lib/api";
import { appChain } from "@/lib/config";
import { txErrorMessage } from "@/hooks/useTx";

type SaveState = { status: "idle" | "signing" | "saving" } | { status: "error"; message: string };

/**
 * Lets the owner name one Chog their Chog holds a grudge against. Free: the owner signs the choice
 * and the backend stores it. The agent then prefers that fight when the odds are fair; it never
 * breaks the owner's onchain limits for it.
 */
export function GrudgePicker({ chog, onDone }: { chog: ChogView; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [input, setInput] = useState("");
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const current = chog.agent?.grudge ?? null;
  const battles = useQuery({ queryKey: ["chogBattles", chog.tokenId], queryFn: () => api.chogBattles(chog.tokenId) });

  // Chogs it has fought, most recent first: the natural candidates for a grudge.
  const foes = [
    ...new Map(
      (battles.data ?? [])
        .map((b) => (b.attacker?.tokenId === chog.tokenId ? b.defender : b.attacker))
        .filter((o): o is NonNullable<typeof o> => !!o && o.tokenId !== chog.tokenId)
        .map((o) => [o.tokenId, o]),
    ).values(),
  ].slice(0, 4);

  async function save(target: string | null) {
    const issuedAt = new Date().toISOString();
    try {
      setState({ status: "signing" });
      const message = grudgeMessage({ chainId: appChain.id, tokenId: BigInt(chog.tokenId), target: target === null ? null : BigInt(target), issuedAt });
      const signature = (await signMessageAsync({ message })) as Hex;
      setState({ status: "saving" });
      await api.setGrudge(chog.tokenId, { target, issuedAt, signature });
      setState({ status: "idle" });
      setInput("");
      onDone();
    } catch (err) {
      setState({ status: "error", message: txErrorMessage(err) });
    }
  }

  const busy = state.status === "signing" || state.status === "saving";
  const valid = /^\d{1,6}$/.test(input) && input !== chog.tokenId;

  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-xl">Grudge</p>
        <p className="text-sm text-muted">
          Name one Chog yours should go after. It will prefer that fight whenever the odds are fair, and never past your budget. Free: a
          signature, nothing onchain.
        </p>
      </div>

      {current ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border-[3px] border-danger/60 bg-danger/10 p-3">
          <p className="font-bold">
            Holding a grudge against{" "}
            <Link href={`/chog/${current}`} className="text-danger underline decoration-dotted underline-offset-4">
              Chog #{current}
            </Link>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => save(null)}
            className="rounded-xl border-[3px] border-ink bg-night-3 px-3 py-1.5 text-sm font-bold shadow-[3px_3px_0_0_var(--ink)] transition-transform duration-150 active:scale-[0.97] disabled:opacity-50"
          >
            Let it go
          </button>
        </div>
      ) : null}

      {foes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">It has fought:</span>
          {foes.map((f) => (
            <button
              key={f.tokenId}
              type="button"
              disabled={busy || f.tokenId === current}
              onClick={() => save(f.tokenId)}
              className="rounded-full border-[3px] border-ink bg-night px-3 py-1 text-sm font-bold transition-colors hover:bg-danger/20 disabled:opacity-40"
            >
              {f.nickname ?? `#${f.tokenId}`}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save(input);
        }}
      >
        <input
          aria-label="Chog number to hold a grudge against"
          inputMode="numeric"
          placeholder="Chog #"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
          className="w-28 rounded-xl border-[3px] border-ink bg-night px-3 py-2 font-mono"
        />
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-xl border-[3px] border-ink bg-danger px-4 py-2 font-display text-base text-ink shadow-[3px_3px_0_0_var(--ink)] transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : current ? "Switch grudge" : "Declare grudge"}
        </button>
      </form>
      <p className="text-sm" aria-live="polite">
        {state.status === "signing" && <span className="text-gold">Sign in your wallet (free)…</span>}
        {state.status === "error" && <span className="text-danger">{state.message}</span>}
      </p>
    </div>
  );
}
