"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import type { Hex } from "viem";
import { normalizeProfileText, profileMessage } from "@chog-world/shared";
import { api } from "@/lib/api";
import { appChain } from "@/lib/config";
import { txErrorMessage } from "./useTx";

export type ProfileSaveState = { status: "idle" | "signing" | "saving" | "saved" } | { status: "error"; message: string };

/**
 * Saves a Chog's nickname and personality: the owner signs the exact text (free, nothing onchain)
 * and the backend checks the signature and screens the text. Resolves true once saved.
 */
export function useSaveProfile(tokenId: string) {
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<ProfileSaveState>({ status: "idle" });

  async function save(nickname: string, personality: string): Promise<boolean> {
    const n = normalizeProfileText(nickname) || null;
    const p = normalizeProfileText(personality) || null;
    const issuedAt = new Date().toISOString();
    try {
      setState({ status: "signing" });
      const message = profileMessage({ chainId: appChain.id, tokenId: BigInt(tokenId), nickname: n, personality: p, issuedAt });
      const signature = (await signMessageAsync({ message })) as Hex;
      setState({ status: "saving" });
      await api.setProfile(tokenId, { nickname: n, personality: p, issuedAt, signature });
      setState({ status: "saved" });
      return true;
    } catch (err) {
      setState({ status: "error", message: txErrorMessage(err) });
      return false;
    }
  }

  return { state, save };
}
