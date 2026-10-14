"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { levelForXp, xpThreshold, TITLE_LABELS, GOAL_LABELS, Goal, type GoalKey } from "@chog-world/shared";
import { api, ApiError, type ChogView } from "@/lib/api";
import { chog as fmtChog, shortAddress, untilLabel } from "@/lib/format";
import { explorerAddress } from "@/lib/config";
import { useLiveJournal, useWorldConfig } from "@/hooks/useWorld";
import { ChogImage } from "@/components/ChogImage";
import { ElementBadge, StatBars, dnaFor } from "@/components/Stats";
import { FeedItem } from "@/components/Feed";
import { AwakenWizard } from "@/components/AwakenWizard";

export default function ChogPage() {
  const { id } = useParams<{ id: string }>();
  const valid = /^\d{1,4}$/.test(id) && Number(id) > 0;
  const { address } = useAccount();
  const config = useWorldConfig();
  const chog = useQuery({
    queryKey: ["chog", id],
    queryFn: () => api.chog(id),
    enabled: valid,
    refetchInterval: 15_000,
  });
  // Set once this page has shown the wizard, so finishing it greets the newly awake Chog.
  const wizardShown = useRef(false);

  if (!valid) return <Missing text="That is not a Chog number." />;
  if (chog.isLoading || config.isLoading) return <PageSkeleton />;
  if (chog.error) {
    const e = chog.error as Error;
    return <Missing text={e instanceof ApiError && e.status === 404 ? `Chog #${id} does not exist.` : e.message} />;
  }
  if (!chog.data || !config.data) return null;

  const c = chog.data;
  const isOwner = !!address && c.owner.toLowerCase() === address.toLowerCase();
  const enrolledByOwner = c.policy.active && c.policy.owner.toLowerCase() === c.owner.toLowerCase();
  const needsAwakening = !c.accountDeployed || !enrolledByOwner || BigInt(c.balance) === 0n;
  const showWizard = isOwner && needsAwakening;
  if (showWizard) wizardShown.current = true;

  return (
    <div className="space-y-8">
      {!address && needsAwakening && (
        <p className="sticker bg-night-2 px-4 py-3 text-sm text-muted">
          Is this your Chog? <span className="text-paper">Connect your wallet</span> to awaken it.
        </p>
      )}
      {showWizard ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr]">
          <IdentityCard chog={c} collection={config.data.deployment.collection} />
          <AwakenWizard chog={c} deployment={config.data.deployment} />
        </div>
      ) : (
        <ChogHome chog={c} collection={config.data.deployment.collection} isOwner={isOwner} justAwoke={wizardShown.current} />
      )}
    </div>
  );
}

function IdentityCard({ chog, collection }: { chog: ChogView; collection: `0x${string}` }) {
  const { stats, hue } = dnaFor(collection, chog.tokenId);
  const accent = `hsl(${hue} 80% 58%)`;
  return (
    <aside className="sticker h-fit overflow-hidden bg-night-2" style={{ ["--chog" as string]: accent }}>
      <ChogImage tokenId={chog.tokenId} size={512} version={chog.character.xp} />
      <div className="space-y-3 border-t-[3px] border-ink p-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl">Chog #{chog.tokenId}</h1>
          <ElementBadge element={stats.element} />
        </div>
        <p className="text-sm text-muted">Born with these stats. Everything after this is earned.</p>
        <StatBars stats={stats} accent={accent} />
      </div>
    </aside>
  );
}

function ChogHome({ chog: c, collection, isOwner, justAwoke }: { chog: ChogView; collection: `0x${string}`; isOwner: boolean; justAwoke: boolean }) {
  const { stats: base, hue } = dnaFor(collection, c.tokenId);
  const accent = `hsl(${hue} 80% 58%)`;
  const journal = useLiveJournal(c.tokenId);
  const now = Date.now() / 1000;
  const injured = c.character.injuredUntil > now;
  const buffed = c.character.buffUntil > now;
  const level = c.character.level || levelForXp(c.character.xp);
  const from = level <= 1 ? 0 : xpThreshold(level - 1);
  const to = xpThreshold(level);
  const pct = Math.min(100, Math.max(0, ((c.character.xp - from) / Math.max(1, to - from)) * 100));
  const name = c.profile?.nickname ?? `Chog #${c.tokenId}`;
  const titles = Object.entries(TITLE_LABELS).filter(([bit]) => (c.character.titles & (1 << Number(bit))) !== 0);
  const goals = (Object.keys(Goal) as GoalKey[]).filter((k) => (c.character.goalMask & Goal[k]) !== 0);

  // Refresh the snapshot whenever the journal says something happened.
  const qc = useQueryClient();
  useEffect(() => {
    if (journal.lastEvent) void qc.invalidateQueries({ queryKey: ["chog", c.tokenId] });
  }, [journal.lastEvent, qc, c.tokenId]);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]" style={{ ["--chog" as string]: accent }}>
      <aside className="space-y-6">
        <div className="sticker overflow-hidden bg-night-2">
          <ChogImage tokenId={c.tokenId} size={512} version={`${c.character.xp}-${c.character.scars}-${c.character.titles}-${injured}`} />
          <div className="space-y-4 border-t-[3px] border-ink p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-4xl leading-none">{name}</h1>
                {c.profile?.nickname && <p className="mt-1 text-sm text-muted">Chog #{c.tokenId}</p>}
              </div>
              <ElementBadge element={c.stats.element} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-display text-xl text-gold">Level {level}</span>
                <span className="font-mono text-xs text-muted">
                  {c.character.xp} / {to} XP
                </span>
              </div>
              <div className="h-4 overflow-hidden rounded-full border-[3px] border-ink bg-night" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next level">
                <div className="h-full rounded-full bg-[var(--chog)] transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-4 gap-2 text-center">
              {[
                ["Rep", c.character.rep],
                ["Wins", c.character.wins],
                ["Losses", c.character.losses],
                ["Scars", c.character.scars],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border-2 border-ink bg-night py-2">
                  <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt>
                  <dd className="font-display text-xl">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="sticker space-y-3 bg-night-2 p-5">
          <h2 className="font-display text-2xl">Stats</h2>
          <p className="text-xs text-muted">Bright: born with. Faint: earned since.</p>
          <StatBars stats={c.stats} base={base} accent={accent} />
        </div>

        {titles.length > 0 && (
          <div className="sticker bg-night-2 p-5">
            <h2 className="mb-3 font-display text-2xl">Trophies</h2>
            <ul className="flex flex-wrap gap-2">
              {titles.map(([bit, t]) => (
                <li key={bit} title={t.how} className="rounded-full border-2 border-ink bg-gold px-3 py-1 text-sm font-bold text-ink">
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section className="space-y-6">
        {justAwoke && (
          <div className="sticker animate-pop-in bg-mint p-5 text-ink">
            <p className="font-display text-2xl">{name} is awake.</p>
            <p>It will make its first move within a minute or so. Watch the journal below.</p>
          </div>
        )}

        <AgentStatus chog={c} injured={injured} buffed={buffed} goals={goals.map((g) => GOAL_LABELS[g])} isOwner={isOwner} />

        <div className="sticker bg-night-2 px-5 pb-2 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl">Journal</h2>
            <span className="text-sm text-muted">live</span>
          </div>
          {journal.isLoading && <p className="py-8 text-center text-muted">Reading its diary…</p>}
          {journal.data && journal.data.length === 0 && <p className="py-8 text-center text-muted">Nothing yet. Its story starts with its first move.</p>}
          {journal.data && journal.data.length > 0 && (
            <ul className="divide-y-2 divide-night-3">
              {journal.data.map((e) => (
                <FeedItem key={e.id} entry={e} showChog={false} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function AgentStatus({ chog: c, injured, buffed, goals, isOwner }: { chog: ChogView; injured: boolean; buffed: boolean; goals: string[]; isOwner: boolean }) {
  const reason = c.inactiveReason;
  const spent = BigInt(c.policy.dailyCap) - BigInt(c.policy.remaining);
  const pctBudget = BigInt(c.policy.dailyCap) > 0n ? Number((spent * 100n) / BigInt(c.policy.dailyCap)) : 0;
  const nextTick = c.agent?.nextTickAt ? new Date(c.agent.nextTickAt).getTime() / 1000 : null;
  const accountUrl = explorerAddress(c.account);

  const headline = !c.character.awakened
    ? "Asleep"
    : reason
      ? reason === "owner changed"
        ? "Changed hands: its agent stood down"
        : reason === "paused"
          ? "Paused by its owner"
          : `Not acting: ${reason}`
      : injured
        ? `Recovering for ${untilLabel(c.character.injuredUntil)}`
        : c.activeRunId !== "0"
          ? "Out on a quest"
          : c.pendingBattleId !== "0"
            ? "Fighting in the Arena"
            : nextTick && nextTick > Date.now() / 1000
              ? `Planning its next move (${untilLabel(nextTick)})`
              : "Deciding what to do";

  return (
    <div className="sticker grid gap-5 bg-night-2 p-5 sm:grid-cols-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Right now</p>
        <p className="mt-1 font-display text-2xl">{headline}</p>
        {c.agent?.lastTickNote && !reason && <p className="mt-1 text-sm text-muted">Last move: {c.agent.lastTickNote}</p>}
        {buffed && <p className="mt-2 inline-block rounded-full bg-monad/25 px-2 py-0.5 text-xs font-bold text-monad">+50% XP active</p>}
        {goals.length > 0 && (
          <p className="mt-3 text-sm">
            <span className="text-muted">Goals: </span>
            {goals.join(" · ")}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Its wallet</span>
          <span className="font-display text-2xl text-gold">{fmtChog(c.balance)} CHOG</span>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Spent today</span>
            <span>
              {fmtChog(spent)} / {fmtChog(c.policy.dailyCap)} · {c.policy.actionsLeft} moves left
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-night">
            <div className={`h-full ${pctBudget > 85 ? "bg-danger" : "bg-gold"}`} style={{ width: `${pctBudget}%` }} />
          </div>
        </div>
        <p className="text-xs text-muted">
          Earned so far: <span className="text-paper">{fmtChog(c.earned)} CHOG</span> · Owner{" "}
          <span className="font-mono">{shortAddress(c.owner)}</span>
          {isOwner && " (you)"}
          {accountUrl && (
            <>
              {" "}
              ·{" "}
              <a href={accountUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                its wallet
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="sticker mx-auto max-w-lg bg-night-2 p-10 text-center">
      <p className="font-display text-3xl">Hmm.</p>
      <p className="mt-2 text-muted">{text}</p>
      <Link href="/chogs" className="sticker press mt-6 inline-block bg-gold px-5 py-2 font-display text-lg text-ink">
        Back to your Chogs
      </Link>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]" aria-busy="true">
      <div className="sticker h-[640px] animate-pulse bg-night-2" />
      <div className="space-y-6">
        <div className="sticker h-40 animate-pulse bg-night-2" />
        <div className="sticker h-96 animate-pulse bg-night-2" />
      </div>
    </div>
  );
}
