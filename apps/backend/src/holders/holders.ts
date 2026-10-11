import { eq, sql } from "drizzle-orm";
import { erc721Abi, parseAbi, type Address, type PublicClient } from "viem";
import type { Deployment } from "@chog-world/shared";
import type { Database } from "../database/db.js";
import { holders } from "../database/schema.js";

const CHUNK = 300;
const supplyAbi = parseAbi(["function totalSupply() view returns (uint256)", "function nextId() view returns (uint256)"]);

/**
 * Who owns which Chog. The real collection is ERC721A without enumeration, so ownership comes from
 * multicalling ownerOf over every id (2,662 calls in chunks); cheap enough to refresh every few minutes.
 */
export class Holders {
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly d: Deployment,
    private readonly configuredSupply?: number,
  ) {}

  /** Highest token id that may exist. Ids start at 1 for both the real collection and DevChog. */
  async maxTokenId(): Promise<number> {
    if (this.configuredSupply) return this.configuredSupply;
    const [total, next] = await this.client.multicall({
      allowFailure: true,
      contracts: [
        { address: this.d.collection, abi: supplyAbi, functionName: "totalSupply" },
        { address: this.d.collection, abi: supplyAbi, functionName: "nextId" },
      ],
    });
    if (next?.status === "success") return Number(next.result) - 1;
    if (total?.status === "success") return Number(total.result);
    throw new Error("collection exposes neither totalSupply nor nextId; set COLLECTION_SUPPLY");
  }

  async refresh(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const max = await this.maxTokenId();
      let seen = 0;
      for (let start = 1; start <= max; start += CHUNK) {
        const ids = Array.from({ length: Math.min(CHUNK, max - start + 1) }, (_, i) => BigInt(start + i));
        const owners = await this.client.multicall({
          allowFailure: true,
          contracts: ids.map((id) => ({ address: this.d.collection, abi: erc721Abi, functionName: "ownerOf" as const, args: [id] as const })),
        });
        const rows = ids.flatMap((id, i) => {
          const r = owners[i];
          return r?.status === "success" ? [{ tokenId: Number(id), owner: (r.result as Address).toLowerCase(), updatedAt: new Date() }] : [];
        });
        if (rows.length) {
          await this.db
            .insert(holders)
            .values(rows)
            .onConflictDoUpdate({ target: holders.tokenId, set: { owner: sql`excluded.owner`, updatedAt: sql`excluded.updated_at` } });
          seen += rows.length;
        }
      }
      return seen;
    } finally {
      this.running = false;
    }
  }

  async ownedBy(owner: Address): Promise<number[]> {
    const rows = await this.db.select({ tokenId: holders.tokenId }).from(holders).where(eq(holders.owner, owner.toLowerCase()));
    return rows.map((r) => r.tokenId).sort((a, b) => a - b);
  }

  /** Re-reads one token's owner (after a transfer the user just made, without waiting for the sweep). */
  async refreshToken(tokenId: number): Promise<Address | undefined> {
    try {
      const owner = await this.client.readContract({ address: this.d.collection, abi: erc721Abi, functionName: "ownerOf", args: [BigInt(tokenId)] });
      await this.db
        .insert(holders)
        .values({ tokenId, owner: owner.toLowerCase() })
        .onConflictDoUpdate({ target: holders.tokenId, set: { owner: owner.toLowerCase(), updatedAt: new Date() } });
      return owner;
    } catch {
      return undefined;
    }
  }
}
