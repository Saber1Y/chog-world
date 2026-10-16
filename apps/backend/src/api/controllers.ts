import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { erc721Abi, formatEther, isAddress, parseAbi, parseEther, zeroHash, type Address } from "viem";
import { EXTERNAL, erc6551RegistryAbi, grudgeMessage, normalizeProfileText, profileMessage, PROFILE_MAX_AGE_MS, NICKNAME_MAX, PERSONALITY_MAX } from "@chog-world/shared";

/** Mirrors Arena.RIVALRY_THRESHOLD. */
const ARENA_RIVALRY_THRESHOLD = 3;
import { revertReason } from "../chain/chain.js";

const accountProxyAbi = parseAbi(["function initialize(address implementation)"]);
import { z } from "zod";
import { APP_CONTEXT, type AppContext } from "../app/context.js";
import { battles, chogs } from "../database/schema.js";
import { screen } from "../security/firewall.js";
import { json } from "./json.js";
import { artStateOf, metadataOf } from "../render/state.js";
import { chogAmount, type CardState } from "../render/card.js";

/** Battles with each side's token id and nickname attached. */
async function withTokens(ctx: AppContext, rows: (typeof battles.$inferSelect)[]) {
  const keys = [...new Set(rows.flatMap((r) => [r.attKey, r.defKey]))];
  const known = keys.length
    ? await ctx.dbHandle.db.select({ key: chogs.key, tokenId: chogs.tokenId, nickname: chogs.nickname }).from(chogs).where(inArray(chogs.key, keys))
    : [];
  const byKey = new Map(known.map((k) => [k.key, k]));
  return rows.map((r) => ({
    ...r,
    attacker: byKey.get(r.attKey) ?? null,
    defender: byKey.get(r.defKey) ?? null,
  }));
}

function tokenIdParam(raw: string): bigint {
  if (!/^\d{1,6}$/.test(raw)) throw new BadRequestException("tokenId must be a positive integer");
  const id = BigInt(raw);
  if (id === 0n) throw new BadRequestException("tokenId must be a positive integer");
  return id;
}

@Controller()
export class WorldController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get("health")
  async health() {
    const head = Number(await this.ctx.chain.publicClient.getBlockNumber());
    // The cursor is the next block to index, so everything below it is done.
    const indexedTo = (await this.ctx.indexer.cursor()) - 1;
    const keeperBalance = await this.ctx.chain.keeperBalance();
    return {
      ok: true,
      chainId: this.ctx.chain.chain.id,
      head,
      indexedTo,
      lag: Math.max(0, head - indexedTo),
      llm: this.ctx.llmName ?? false,
      keeper: this.ctx.chain.keeper.account.address,
      keeperBalance: formatEther(keeperBalance),
      keeperLow: keeperBalance < parseEther(this.ctx.env.KEEPER_MIN_BALANCE),
    };
  }

  @Get("config")
  async config() {
    const { env, chain } = this.ctx;
    const pilot = await this.ctx.agent.pilotKeys();
    return {
      chainId: chain.chain.id,
      deployment: chain.deployment,
      keeper: chain.keeper.account.address,
      tickMinutes: env.TICK_MINUTES,
      llmEnabled: this.ctx.llmEnabled,
      // Set during a capped launch: how many Chogs the agent serves and how many places are taken.
      pilot: pilot ? { max: env.PILOT_MAX_CHOGS, joined: pilot.size } : null,
    };
  }

  @Get("feed")
  async feed(@Query("limit") limit?: string) {
    const rows = await this.ctx.journal.recentWorld(Number(limit ?? 40) || 40);
    const keys = [...new Set(rows.map((r) => r.chogKey))];
    const owners = keys.length
      ? await this.ctx.dbHandle.db.select({ key: chogs.key, tokenId: chogs.tokenId, nickname: chogs.nickname }).from(chogs).where(inArray(chogs.key, keys))
      : [];
    const byKey = new Map(owners.map((o) => [o.key, o]));
    return rows.map((r) => ({ ...r, tokenId: byKey.get(r.chogKey)?.tokenId ?? null, nickname: byKey.get(r.chogKey)?.nickname ?? null }));
  }

  @Get("leaderboard")
  async leaderboard(@Query("by") by = "rep", @Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit ?? 25) || 25, 1), 100);
    const order =
      by === "level" ? [desc(chogs.level), desc(chogs.xp)] : by === "earned" ? [desc(sql`${chogs.earned}::numeric`)] : by === "wins" ? [desc(chogs.wins), desc(chogs.rep)] : [desc(chogs.rep), desc(chogs.level)];
    const rows = await this.ctx.dbHandle.db.select().from(chogs).orderBy(...order).limit(n);
    return rows.map((r) => ({
      tokenId: r.tokenId,
      nickname: r.nickname,
      level: r.level,
      xp: r.xp,
      rep: r.rep,
      wins: r.wins,
      losses: r.losses,
      titles: r.titles,
      scars: r.scars,
      earned: r.earned,
      enrolled: r.enrolled,
    }));
  }
}

@Controller("owners")
export class OwnersController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  /** The Chogs a wallet owns, with whatever the world already knows about each. */
  @Get(":address/chogs")
  async chogsOf(@Param("address") address: string) {
    if (!isAddress(address)) throw new BadRequestException("invalid address");
    const ids = await this.ctx.holders.ownedBy(address as Address);
    const known = ids.length
      ? await this.ctx.dbHandle.db
          .select()
          .from(chogs)
          .where(inArray(chogs.tokenId, ids.map(String)))
      : [];
    const byId = new Map(known.map((k) => [k.tokenId, k]));
    return ids.map((id) => {
      const k = byId.get(String(id));
      return {
        tokenId: String(id),
        awakened: !!k,
        enrolled: k?.enrolled ?? false,
        nickname: k?.nickname ?? null,
        level: k?.level ?? 1,
        rep: k?.rep ?? 0,
        account: k?.account ?? null,
      };
    });
  }
}

const ProfileBody = z.object({
  nickname: z.string().max(NICKNAME_MAX).nullable(),
  personality: z.string().max(PERSONALITY_MAX).nullable(),
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

const GrudgeBody = z.object({
  target: z.string().regex(/^\d{1,6}$/).nullable(),
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

@Controller("chogs")
export class ChogsController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get(":tokenId")
  async get(@Param("tokenId") raw: string) {
    const tokenId = tokenIdParam(raw);
    const snapshot = await this.snapshotOr404(tokenId);
    const [row] = await this.ctx.dbHandle.db.select().from(chogs).where(eq(chogs.key, snapshot.key));
    const pilot = await this.ctx.agent.pilotKeys();
    return json({
      ...snapshot,
      profile: row ? { nickname: row.nickname, personality: row.personality } : null,
      agent: row
        ? {
            enrolled: row.enrolled,
            nextTickAt: row.nextTickAt,
            lastTickAt: row.lastTickAt,
            lastTickNote: row.lastTickNote,
            grudge: row.grudgeTokenId,
            // False only during a capped pilot that this Chog did not get into.
            inPilot: !pilot || pilot.has(row.key),
          }
        : null,
      earned: row?.earned ?? "0",
    });
  }

  /** The evolved Chog as a PNG. `size` 128..1024; cached by state, so it changes only when the Chog does. */
  @Get(":tokenId/image.png")
  async image(@Param("tokenId") raw: string, @Query("size") sizeRaw: string | undefined, @Res() res: Response) {
    const tokenId = tokenIdParam(raw);
    const size = sizeRaw ? Math.round(Number(sizeRaw)) : 1024;
    if (!Number.isFinite(size) || size < 128 || size > 1024) throw new BadRequestException("size must be 128..1024");
    const { art } = await this.artOf(tokenId);
    const etag = `"${createHash("sha1").update(JSON.stringify(art)).update(String(size)).digest("hex")}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=30");
    if (res.req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    const png = await this.ctx.renderer.png(art, size);
    res.type("png").send(png);
  }

  /** A 1200x630 share card for social previews, cached like the portrait. */
  @Get(":tokenId/card.png")
  async card(@Param("tokenId") raw: string, @Res() res: Response) {
    const tokenId = tokenIdParam(raw);
    const { snapshot, art } = await this.artOf(tokenId);
    const [row] = await this.ctx.dbHandle.db.select({ earned: chogs.earned }).from(chogs).where(eq(chogs.key, snapshot.key));
    const c = snapshot.character;
    const state: CardState = {
      art,
      rep: c.rep,
      wins: c.wins,
      losses: c.losses,
      quests: c.quests,
      earned: chogAmount(BigInt(row?.earned ?? "0")),
      site: new URL(this.ctx.env.SITE_URL).host,
    };
    const etag = `"${createHash("sha1").update(JSON.stringify(state)).digest("hex")}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=300");
    if (res.req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.type("png").send(await this.ctx.renderer.card(state));
  }

  @Get(":tokenId/meta")
  async meta(@Param("tokenId") raw: string) {
    const tokenId = tokenIdParam(raw);
    const { snapshot, art } = await this.artOf(tokenId);
    return metadataOf(snapshot, art, `${this.ctx.env.PUBLIC_URL}/chogs/${tokenId}/image.png`);
  }

  private async snapshotOr404(tokenId: bigint) {
    try {
      return await this.ctx.reader.snapshot(tokenId);
    } catch {
      throw new NotFoundException(`Chog #${tokenId} does not exist`);
    }
  }

  private async artOf(tokenId: bigint) {
    const snapshot = await this.snapshotOr404(tokenId);
    const [row] = await this.ctx.dbHandle.db.select({ nickname: chogs.nickname }).from(chogs).where(eq(chogs.key, snapshot.key));
    return { snapshot, art: artStateOf(snapshot, row?.nickname ?? null) };
  }

  @Get(":tokenId/journal")
  async journal(@Param("tokenId") raw: string, @Query("before") before?: string, @Query("limit") limit?: string) {
    const key = await this.ctx.reader.keyOf(tokenIdParam(raw));
    return this.ctx.journal.list(key, { limit: Number(limit ?? 50) || 50, ...(before ? { beforeId: Number(before) } : {}) });
  }

  /** "While you were away": everything since `since` (ISO time the owner last looked). */
  @Get(":tokenId/digest")
  async digest(@Param("tokenId") raw: string, @Query("since") since?: string) {
    const key = await this.ctx.reader.keyOf(tokenIdParam(raw));
    const from = since ? new Date(since) : new Date(Date.now() - 24 * 3_600_000);
    if (Number.isNaN(from.getTime())) throw new BadRequestException("since must be an ISO date");
    return (await this.ctx.digests.forVisit(key, from)) ?? null;
  }

  @Get(":tokenId/battles")
  async battlesOf(@Param("tokenId") raw: string) {
    const key = await this.ctx.reader.keyOf(tokenIdParam(raw));
    const rows = await this.ctx.dbHandle.db
      .select()
      .from(battles)
      .where(or(eq(battles.attKey, key), eq(battles.defKey, key)))
      .orderBy(desc(battles.startBlock))
      .limit(30);
    return withTokens(this.ctx, rows);
  }

  /** Owner-signed nickname and personality. Screened before it can ever reach the decider prompt. */
  @Put(":tokenId/profile")
  async setProfile(@Param("tokenId") raw: string, @Body() body: unknown) {
    const tokenId = tokenIdParam(raw);
    const parsed = ProfileBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    const p = parsed.data;
    const issued = new Date(p.issuedAt).getTime();
    if (Math.abs(Date.now() - issued) > PROFILE_MAX_AGE_MS) throw new BadRequestException("signature expired; sign again");

    const nickname = p.nickname ? normalizeProfileText(p.nickname) || null : null;
    const personality = p.personality ? normalizeProfileText(p.personality) || null : null;
    for (const [field, text] of [["nickname", nickname], ["personality", personality]] as const) {
      if (!text) continue;
      const r = screen(text);
      if (!r.ok) {
        throw new BadRequestException(
          `That ${field} reads like instructions to the agent. Describe the Chog instead (for example "greedy but cautious, hates slime").`,
        );
      }
    }

    const snapshot = await this.ctx.reader.snapshot(tokenId);
    const message = profileMessage({ chainId: this.ctx.chain.chain.id, tokenId, nickname, personality, issuedAt: p.issuedAt });
    const valid = await this.ctx.chain.publicClient.verifyMessage({ address: snapshot.owner, message, signature: p.signature as `0x${string}` });
    if (!valid) throw new ForbiddenException("signature is not from this Chog's owner");
    // Owners may name a Chog before it is awake (the wizard asks for the name in the same step that
    // awakens it), and before the indexer has seen it: create its row if needed.
    await this.ctx.dbHandle.db
      .insert(chogs)
      .values({
        key: snapshot.key,
        collection: snapshot.collection.toLowerCase(),
        tokenId: snapshot.tokenId.toString(),
        account: snapshot.account.toLowerCase(),
        nickname,
        personality,
      })
      .onConflictDoUpdate({ target: chogs.key, set: { nickname, personality } });
    return { nickname, personality };
  }

  /**
   * Owner-signed grudge: the Chog its agent should prefer to challenge. Free (a signature, nothing
   * onchain); the agent still respects the odds and the owner's onchain limits.
   */
  @Put(":tokenId/grudge")
  async setGrudge(@Param("tokenId") raw: string, @Body() body: unknown) {
    const tokenId = tokenIdParam(raw);
    const parsed = GrudgeBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    const g = parsed.data;
    if (Math.abs(Date.now() - new Date(g.issuedAt).getTime()) > PROFILE_MAX_AGE_MS) throw new BadRequestException("signature expired; sign again");
    const target = g.target === null ? null : BigInt(g.target);

    const snapshot = await this.snapshotOr404(tokenId);
    const message = grudgeMessage({ chainId: this.ctx.chain.chain.id, tokenId, target, issuedAt: g.issuedAt });
    const valid = await this.ctx.chain.publicClient.verifyMessage({ address: snapshot.owner, message, signature: g.signature as `0x${string}` });
    if (!valid) throw new ForbiddenException("signature is not from this Chog's owner");
    if (!snapshot.policy.active) throw new BadRequestException("wake its agent first: only an active Chog can hold a grudge");

    if (target !== null) {
      if (target === tokenId) throw new BadRequestException("a Chog cannot hold a grudge against itself");
      let targetOwner: Address;
      try {
        targetOwner = await this.ctx.chain.publicClient.readContract({ address: this.ctx.chain.deployment.collection, abi: erc721Abi, functionName: "ownerOf", args: [target] });
      } catch {
        throw new NotFoundException(`Chog #${target} does not exist`);
      }
      // The Arena refuses fights between Chogs of the same owner.
      if (targetOwner.toLowerCase() === snapshot.owner.toLowerCase()) throw new BadRequestException("both Chogs are yours, and the Arena never matches a Chog against its own owner");
    }

    const db = this.ctx.dbHandle.db;
    const [row] = await db.select({ grudge: chogs.grudgeTokenId }).from(chogs).where(eq(chogs.key, snapshot.key));
    if (!row) throw new BadRequestException("wake its agent first: only an active Chog can hold a grudge");
    const next = target === null ? null : target.toString();
    if (row.grudge !== next) {
      await db.update(chogs).set({ grudgeTokenId: next }).where(eq(chogs.key, snapshot.key));
      await this.ctx.journal.write({
        chogKey: snapshot.key,
        kind: "policy",
        title: next ? `Owner declared a grudge against Chog #${next}` : "Owner let its grudge go",
        data: { grudge: next },
        sourceKey: `grudge:${snapshot.key}:${g.issuedAt}`,
      });
      // A fresh grudge is worth acting on now rather than at the next scheduled move.
      if (next) await db.update(chogs).set({ nextTickAt: new Date() }).where(eq(chogs.key, snapshot.key));
    }
    return { grudge: next };
  }

  /**
   * Creates the Chog's token-bound account, paid by the keeper, so awakening costs the owner nothing
   * extra. Creating and initializing are permissionless and give the caller no rights over the
   * account: it is controlled only by whoever owns the NFT.
   */
  @Post(":tokenId/account")
  async createAccount(@Param("tokenId") raw: string) {
    const tokenId = tokenIdParam(raw);
    const d = this.ctx.chain.deployment;
    const client = this.ctx.chain.publicClient;
    try {
      await client.readContract({ address: d.collection, abi: erc721Abi, functionName: "ownerOf", args: [tokenId] });
    } catch {
      throw new NotFoundException(`Chog #${tokenId} does not exist`);
    }
    const account = await this.ctx.reader.accountOf(tokenId);
    const code = await client.getCode({ address: account });
    if (code && code !== "0x") return { account, created: false };

    const key = `account:${tokenId}`;
    if (this.creating.has(key)) throw new ConflictException("account creation already in progress");
    this.creating.add(key);
    try {
      const { hash } = await this.ctx.chain.keeper.send({
        address: EXTERNAL.erc6551Registry,
        abi: erc6551RegistryAbi,
        functionName: "createAccount",
        args: [EXTERNAL.tokenboundAccountProxy, zeroHash, BigInt(this.ctx.chain.chain.id), d.collection, tokenId],
      });
      const { hash: initHash } = await this.ctx.chain.keeper.send({
        address: account,
        abi: accountProxyAbi,
        functionName: "initialize",
        args: [EXTERNAL.tokenboundAccountV3],
      });
      return { account, created: true, txHashes: [hash, initHash] };
    } catch (err) {
      throw new ServiceUnavailableException(`could not create the account: ${revertReason(err)}`);
    } finally {
      this.creating.delete(key);
    }
  }

  private readonly creating = new Set<string>();

  /**
   * Asks the agent to act soon (after the owner enrolls or tops up). Safe to expose: the agent can
   * only ever do what the owner's onchain policy allows.
   */
  @Post(":tokenId/nudge")
  @HttpCode(202)
  async nudge(@Param("tokenId") raw: string) {
    const key = await this.ctx.reader.keyOf(tokenIdParam(raw));
    await this.ctx.dbHandle.db
      .update(chogs)
      .set({ nextTickAt: new Date() })
      .where(and(eq(chogs.key, key), eq(chogs.enrolled, true)));
    return { queued: true };
  }
}

@Controller("arena")
export class ArenaController {
  constructor(@Inject(APP_CONTEXT) private readonly ctx: AppContext) {}

  @Get("battles")
  async recent(@Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit ?? 30) || 30, 1), 100);
    const rows = await this.ctx.dbHandle.db.select().from(battles).orderBy(desc(battles.startBlock)).limit(n);
    return withTokens(this.ctx, rows);
  }

  /** Pairs that keep meeting in the Arena, most fights first. Built from the last 1,000 resolved battles. */
  @Get("rivalries")
  async rivalries(@Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit ?? 12) || 12, 1), 50);
    const rows = await this.ctx.dbHandle.db
      .select()
      .from(battles)
      .where(eq(battles.status, "resolved"))
      .orderBy(desc(battles.startBlock))
      .limit(1_000);
    const pairs = new Map<string, { a: string; b: string; fights: number; winsA: number; winsB: number; lastBattleId: string }>();
    for (const r of rows) {
      const [a, b] = r.attKey < r.defKey ? [r.attKey, r.defKey] : [r.defKey, r.attKey];
      const key = `${a}:${b}`;
      const p = pairs.get(key) ?? { a, b, fights: 0, winsA: 0, winsB: 0, lastBattleId: r.battleId };
      p.fights += 1;
      const winner = r.attackerWon ? r.attKey : r.defKey;
      if (winner === a) p.winsA += 1;
      else p.winsB += 1;
      pairs.set(key, p);
    }
    const top = [...pairs.values()].filter((p) => p.fights >= 2).sort((x, y) => y.fights - x.fights).slice(0, n);
    const keys = [...new Set(top.flatMap((p) => [p.a, p.b]))];
    const known = keys.length
      ? await this.ctx.dbHandle.db.select({ key: chogs.key, tokenId: chogs.tokenId, nickname: chogs.nickname }).from(chogs).where(inArray(chogs.key, keys))
      : [];
    const byKey = new Map(known.map((k) => [k.key, k]));
    return top.map((p) => ({
      a: byKey.get(p.a) ?? null,
      b: byKey.get(p.b) ?? null,
      fights: p.fights,
      winsA: p.winsA,
      winsB: p.winsB,
      rivals: p.fights >= ARENA_RIVALRY_THRESHOLD,
      lastBattleId: p.lastBattleId,
    }));
  }

  @Get("battles/:id")
  async one(@Param("id") id: string) {
    if (!/^\d+$/.test(id)) throw new BadRequestException("invalid battle id");
    const rows = await this.ctx.dbHandle.db.select().from(battles).where(eq(battles.battleId, id));
    if (!rows[0]) throw new NotFoundException("no such battle");
    return (await withTokens(this.ctx, rows))[0];
  }

}
