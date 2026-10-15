import type { Address, Hex } from "viem";
import type { Deployment, Stats } from "@chog-world/shared";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError(0, "CHOG World is unreachable right now. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    } catch {
      // keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface WorldConfig {
  chainId: number;
  deployment: Deployment;
  keeper: Address;
  tickMinutes: number;
  llmEnabled: boolean;
}

export interface OwnedChog {
  tokenId: string;
  awakened: boolean;
  enrolled: boolean;
  nickname: string | null;
  level: number;
  rep: number;
  account: Address | null;
}

/** /chogs/:id: the onchain snapshot, bigints as decimal strings. */
export interface ChogView {
  tokenId: string;
  key: Hex;
  account: Address;
  accountDeployed: boolean;
  owner: Address;
  character: {
    awakened: boolean;
    bornAt: number;
    xp: number;
    level: number;
    rep: number;
    wins: number;
    losses: number;
    quests: number;
    injuredUntil: number;
    buffUntil: number;
    titles: number;
    scars: number;
    goalMask: number;
    zonesVisited: number;
    streak: number;
    lastCheckIn: number;
  };
  stats: Stats;
  policy: {
    owner: Address;
    active: boolean;
    paused: boolean;
    actionMask: number;
    expiry: number;
    maxPerAction: string;
    dailyCap: string;
    maxActionsPerDay: number;
    actionsToday: number;
    remaining: string;
    actionsLeft: number;
  };
  inactiveReason: string;
  balance: string;
  items: Record<string, number>;
  activeRunId: string;
  pendingBattleId: string;
  blockTime: number;
  profile: { nickname: string | null; personality: string | null } | null;
  agent: { enrolled: boolean; nextTickAt: string; lastTickAt: string | null; lastTickNote: string | null } | null;
  earned: string;
}

export interface JournalEntry {
  id: number;
  chogKey: string;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  txHash: string | null;
  createdAt: string;
  tokenId?: string | null;
  nickname?: string | null;
}

export interface LeaderRow {
  tokenId: string;
  nickname: string | null;
  level: number;
  xp: number;
  rep: number;
  wins: number;
  losses: number;
  titles: number;
  scars: number;
  earned: string;
  enrolled: boolean;
}

export interface ChogRef {
  key: string;
  tokenId: string;
  nickname: string | null;
}

export interface Battle {
  battleId: string;
  attKey: string;
  defKey: string;
  tier: number;
  fee: string;
  startBlock: number;
  status: "pending" | "resolved" | "voided";
  attackerWon: boolean | null;
  seed: Hex | null;
  logHash: Hex | null;
  rounds: number | null;
  repDelta: number | null;
  payout: string | null;
  /** Present only when the indexer verified the replay against the onchain logHash. */
  attStats: Stats | null;
  defStats: Stats | null;
  resolveTx: string | null;
  createdAt: string;
  attacker: ChogRef | null;
  defender: ChogRef | null;
}

export interface Rivalry {
  a: ChogRef | null;
  b: ChogRef | null;
  fights: number;
  winsA: number;
  winsB: number;
  rivals: boolean;
  lastBattleId: string;
}

export interface Digest {
  text: string;
  writtenBy: "llm" | "template";
  fromTime: string;
  toTime: string;
}

export const api = {
  config: () => request<WorldConfig>("/config"),
  feed: (limit = 30) => request<JournalEntry[]>(`/feed?limit=${limit}`),
  leaderboard: (by: "rep" | "level" | "wins" | "earned" = "rep") => request<LeaderRow[]>(`/leaderboard?by=${by}`),
  owned: (address: Address) => request<OwnedChog[]>(`/owners/${address}/chogs`),
  chog: (tokenId: string) => request<ChogView>(`/chogs/${tokenId}`),
  journal: (tokenId: string) => request<JournalEntry[]>(`/chogs/${tokenId}/journal?limit=60`),
  digest: (tokenId: string, since: string) => request<Digest | null>(`/chogs/${tokenId}/digest?since=${encodeURIComponent(since)}`),
  battles: (limit = 30) => request<Battle[]>(`/arena/battles?limit=${limit}`),
  battle: (id: string) => request<Battle>(`/arena/battles/${id}`),
  rivalries: () => request<Rivalry[]>("/arena/rivalries"),
  chogBattles: (tokenId: string) => request<Battle[]>(`/chogs/${tokenId}/battles`),
  createAccount: (tokenId: string) =>
    request<{ account: Address; created: boolean; txHashes?: Hex[] }>(`/chogs/${tokenId}/account`, { method: "POST" }),
  setProfile: (tokenId: string, body: { nickname: string | null; personality: string | null; issuedAt: string; signature: Hex }) =>
    request<{ nickname: string | null; personality: string | null }>(`/chogs/${tokenId}/profile`, { method: "PUT", body: JSON.stringify(body) }),
  nudge: (tokenId: string) => request<{ queued: boolean }>(`/chogs/${tokenId}/nudge`, { method: "POST" }),
};

/** The server-rendered evolved Chog. `v` busts the cache when its state changes. */
export function chogImageUrl(tokenId: string, size = 512, v?: string | number): string {
  return `${API_URL}/chogs/${tokenId}/image.png?size=${size}${v !== undefined ? `&v=${v}` : ""}`;
}
