import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { parseAbi, type Address, type PublicClient } from "viem";
import { CANVAS } from "./art.js";

const GATEWAYS = ["https://gateway.pinata.cloud/ipfs", "https://w3s.link/ipfs", "https://dweb.link/ipfs"];
const tokenUriAbi = parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]);

/** Resolve ipfs:// and plain URLs to fetchable ones, trying each IPFS gateway in turn. */
function candidates(uri: string): string[] {
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    return GATEWAYS.map((g) => `${g}/${path}`);
  }
  return [uri];
}

async function fetchFirst(uri: string, timeoutMs: number): Promise<Response> {
  let lastError: unknown;
  for (const url of candidates(uri)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastError = new Error(`${url} answered ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`could not fetch ${uri}: ${(lastError as Error)?.message ?? lastError}`);
}

/**
 * Each Chog's own NFT picture, for collections where every token looks different (Chog Genesis).
 * Reads tokenURI, follows the metadata to the image, and caches a 1024px PNG per token on disk, so
 * IPFS is hit once per Chog. The evolved overlay is drawn on top of it.
 */
export class TokenArt {
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly client: PublicClient,
    private readonly collection: Address,
    private readonly cacheDir: string,
    private readonly timeoutMs = 30_000,
  ) {}

  base(tokenId: string): Promise<Buffer> {
    let p = this.inflight.get(tokenId);
    if (!p) {
      p = this.load(tokenId).finally(() => this.inflight.delete(tokenId));
      this.inflight.set(tokenId, p);
    }
    return p;
  }

  private async load(tokenId: string): Promise<Buffer> {
    const file = join(this.cacheDir, `token-${tokenId}.png`);
    if (existsSync(file)) return readFileSync(file);
    const uri = await this.client.readContract({ address: this.collection, abi: tokenUriAbi, functionName: "tokenURI", args: [BigInt(tokenId)] });
    const meta = (await (await fetchFirst(uri, this.timeoutMs)).json()) as { image?: string };
    if (!meta.image) throw new Error(`Chog #${tokenId} metadata has no image`);
    const raw = Buffer.from(await (await fetchFirst(meta.image, this.timeoutMs)).arrayBuffer());
    const png = await sharp(raw).resize(CANVAS, CANVAS, { fit: "cover" }).png().toBuffer();
    mkdirSync(this.cacheDir, { recursive: true });
    writeFileSync(file, png);
    return png;
  }
}
