import { defineChain, type Address } from "viem";

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://monadscan.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const SUPPORTED_CHAINS = [monad, monadTestnet] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]["id"];

/** External contracts CHOG World builds on. Verified on Monad mainnet with read-only RPC calls. */
export const EXTERNAL = {
  erc6551Registry: "0x000000006551c19487814612e58FE06813775758",
  tokenboundAccountProxy: "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
  tokenboundAccountV3: "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const satisfies Record<string, Address>;

/** The real Chog NFT (Chog Genesis) and $CHOG on Monad mainnet. */
export const MAINNET_ASSETS = {
  chogNft: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763",
  chogToken: "0x350035555E10d9AfAF1566AaebfCeD5BA6C27777",
  chogSupply: 1969,
} as const;
