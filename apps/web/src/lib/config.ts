import { monad, monadTestnet } from "@chog-world/shared";
import type { Chain } from "viem";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:9100").replace(/\/$/, "");
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? monadTestnet.id);
/** Optional RPC override, e.g. a local anvil fork from scripts/local-world.mjs. */
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;

const base = CHAIN_ID === monad.id ? monad : monadTestnet;
export const appChain: Chain = RPC_URL
  ? { ...base, name: `${base.name} (local)`, rpcUrls: { default: { http: [RPC_URL] } } }
  : base;

export const isTestnet = appChain.id === monadTestnet.id;
/** A local anvil fork shares testnet's chain id but none of its state: label it differently. */
export const isLocalFork = !!RPC_URL;

export function explorerTx(hash: string): string | null {
  // A local fork has no explorer; the hash is still shown.
  if (RPC_URL) return null;
  return `${appChain.blockExplorers?.default.url}/tx/${hash}`;
}

export function explorerAddress(address: string): string | null {
  if (RPC_URL) return null;
  return `${appChain.blockExplorers?.default.url}/address/${address}`;
}
