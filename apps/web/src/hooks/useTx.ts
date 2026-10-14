"use client";

import { useCallback, useState } from "react";
import { BaseError, UserRejectedRequestError, type Hash } from "viem";
import { usePublicClient } from "wagmi";

export type TxState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "pending"; hash: Hash }
  | { status: "done"; hash: Hash }
  | { status: "error"; message: string };

/** Human message for a failed wallet or chain call. */
export function txErrorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled in your wallet. Nothing was sent.";
    const revert = err.walk((e) => (e as { name?: string }).name === "ContractFunctionRevertedError") as
      | { data?: { errorName?: string }; reason?: string }
      | null;
    if (revert?.data?.errorName) return `The contract refused: ${revert.data.errorName}.`;
    if (/insufficient funds/i.test(err.message)) return "Not enough MON for gas in this wallet.";
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Wraps one transaction: sign, wait for the receipt, report. `send` returns the tx hash (e.g. from
 * wagmi's writeContractAsync). Resolves true only once the transaction is confirmed successfully.
 */
export function useTx() {
  const client = usePublicClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (send: () => Promise<Hash>): Promise<boolean> => {
      setState({ status: "signing" });
      try {
        const hash = await send();
        setState({ status: "pending", hash });
        const receipt = await client!.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          setState({ status: "error", message: "The transaction was mined but reverted." });
          return false;
        }
        setState({ status: "done", hash });
        return true;
      } catch (err) {
        setState({ status: "error", message: txErrorMessage(err) });
        return false;
      }
    },
    [client],
  );

  return { state, run, reset: () => setState({ status: "idle" }) };
}
