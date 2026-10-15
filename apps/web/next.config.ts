import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a production build run alongside `next dev` without clobbering it (NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@chog-world/shared"],
  images: {
    remotePatterns: [{ protocol: "http", hostname: "localhost" }, { protocol: "https", hostname: "**" }],
  },
  webpack: (config) => {
    // WalletConnect pulls optional pino/lokijs deps that do not exist in the browser build.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // RainbowKit -> wagmi connectors -> Base Account -> Coinbase CDP SDK, whose server-side x402
    // payment helpers dynamically import optional packages that are not installed. This app never
    // calls them; resolve them to empty modules instead of failing the build.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
      // MetaMask's SDK imports React Native storage for its mobile build; browsers never load it.
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
