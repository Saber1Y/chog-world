import { formatEther } from "viem";
import { QUESTS } from "@chog-world/shared";
import type { ChogView } from "./api";

/** MON amounts with up to 3 decimals, for gas tanks and fees. */
export function mon(wei: string | bigint, digits = 3): string {
  const [i, f = ""] = formatEther(BigInt(wei)).split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  return `${i}${frac ? `.${frac}` : ""}`;
}

export interface GasTank {
  /** MON in the Chog's account. */
  balance: bigint;
  /** The world charges a gas fee for at least one kind of move. */
  charges: boolean;
  /** The most expensive and the typical (quest) fee per move. */
  maxFee: bigint;
  questFee: bigint;
  /** About how many quest moves the tank covers. */
  moves: number;
  /** Too little MON for even the cheapest paid move. */
  empty: boolean;
  /** The world's fee is above what the owner agreed to pay per move. */
  overLimit: boolean;
}

/** Everything the UI needs to say about a Chog paying for its own gas. */
export function gasTank(c: Pick<ChogView, "gas" | "policy">): GasTank {
  const fees = c.gas.fees.map((f) => BigInt(f));
  const paid = fees.filter((f) => f > 0n);
  const balance = BigInt(c.gas.balance);
  const maxFee = paid.reduce((m, f) => (f > m ? f : m), 0n);
  const minFee = paid.reduce((m, f) => (f < m ? f : m), maxFee);
  const questFee = fees[0] ?? 0n;
  return {
    balance,
    charges: paid.length > 0,
    maxFee,
    questFee,
    moves: questFee > 0n ? Number(balance / questFee) : Infinity,
    empty: paid.length > 0 && balance < minFee,
    overLimit: paid.length > 0 && maxFee > BigInt(c.policy.maxGasFee),
  };
}

/** The cheapest quest entry fee: below this a Chog cannot afford any move that costs CHOG. */
export const CHEAPEST_FEE = QUESTS.reduce((m, q) => (q.fee < m ? q.fee : m), QUESTS[0]!.fee);

/** Funded enough to start playing: some CHOG for fees and, when the world charges gas, a full move of MON. */
export function isFunded(c: Pick<ChogView, "gas" | "policy" | "balance">): boolean {
  const tank = gasTank(c);
  return BigInt(c.balance) > 0n && (!tank.charges || tank.balance >= tank.maxFee);
}
