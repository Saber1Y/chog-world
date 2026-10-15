"use client";

import { useState } from "react";
import { useAccount, useBalance, useSendTransaction } from "wagmi";
import { parseEther } from "viem";
import type { ChogView } from "@/lib/api";
import { gasTank, mon } from "@/lib/gas";
import { useTx } from "@/hooks/useTx";
import { TxStatus } from "./TxStatus";

const AMOUNTS = ["0.5", "1", "2"];

/**
 * Sends MON from the owner's wallet into the Chog's own account, which pays the keeper a small fee
 * per move. It is a plain transfer to the Chog: only the NFT's owner can ever move it back out.
 */
export function GasTopUp({ chog, onDone }: { chog: ChogView; onDone: () => void }) {
  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const wallet = useBalance({ address, query: { enabled: !!address } });
  const tx = useTx();
  const [amount, setAmount] = useState("1");
  const tank = gasTank(chog);
  const wei = parseEther(amount);
  // Keep a little MON in the owner's wallet for their own transactions.
  const tooMuch = wallet.data !== undefined && wei + parseEther("0.05") > wallet.data.value;
  const movesBought = tank.questFee > 0n ? Number(wei / tank.questFee) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="MON to add">
        {AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={amount === a}
            onClick={() => setAmount(a)}
            className={`rounded-full border-[3px] border-ink px-4 py-1.5 font-bold transition-colors ${amount === a ? "bg-monad" : "bg-night text-muted hover:text-paper"}`}
          >
            {a} MON
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        In your wallet: {wallet.data ? `${mon(wallet.data.value)} MON` : "…"}
        {movesBought > 0 && <> · covers about {movesBought} quests</>}
        {tooMuch && <span className="ml-2 text-danger">Leave a little MON for your own gas.</span>}
      </p>
      <button
        type="button"
        disabled={tooMuch || tx.state.status === "signing" || tx.state.status === "pending"}
        onClick={async () => {
          const ok = await tx.run(() => sendTransactionAsync({ to: chog.account, value: wei }));
          if (ok) {
            void wallet.refetch();
            onDone();
          }
        }}
        className="sticker press bg-monad px-5 py-2.5 font-display text-lg text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none"
      >
        {tx.state.status === "signing" || tx.state.status === "pending" ? "Working…" : `Add ${amount} MON for gas`}
      </button>
      <TxStatus state={tx.state} />
    </div>
  );
}
