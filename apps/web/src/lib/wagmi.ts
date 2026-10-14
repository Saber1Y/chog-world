import { connectorsForWallets, type Wallet } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient } from "@tanstack/react-query";
import { createConfig, createConnector, http, mock } from "wagmi";
import type { Address } from "viem";
import { appChain } from "./config";

/** WalletConnect needs a real project id for mobile wallets; injected wallets work without one. */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "chog-world-dev";

/**
 * Local development only: a wallet backed by an anvil development account, which anvil signs for.
 * Enabled with NEXT_PUBLIC_DEV_WALLET=true and only when an RPC override (a local fork) is set, so it
 * can never appear against a real network.
 */
const DEV_ACCOUNT = (process.env.NEXT_PUBLIC_DEV_WALLET_ACCOUNT ?? "0x976EA74026E726554dB657fA54763abd0C3a0aa9") as Address;
const devWalletEnabled = process.env.NEXT_PUBLIC_DEV_WALLET === "true" && !!process.env.NEXT_PUBLIC_RPC_URL;

const devWallet = (): Wallet => ({
  id: "chog-dev",
  name: "Local test wallet",
  iconUrl:
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="#ffd23f"/><text x="14" y="20" text-anchor="middle" font-family="Arial" font-weight="900" font-size="15" fill="#0b0716">T</text></svg>'),
  iconBackground: "#ffd23f",
  createConnector: (details) =>
    createConnector((config) => ({ ...mock({ accounts: [DEV_ACCOUNT], features: { reconnect: true } })(config), ...details })),
});

const connectors = connectorsForWallets(
  [
    { groupName: "Popular", wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, injectedWallet] },
    ...(devWalletEnabled ? [{ groupName: "Development", wallets: [devWallet] }] : []),
  ],
  { appName: "CHOG World", projectId },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [appChain],
  transports: { [appChain.id]: http(appChain.rpcUrls.default.http[0]) },
  ssr: true,
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 } },
});
