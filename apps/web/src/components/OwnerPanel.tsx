"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import {
  accountV3Abi,
  chogOperatorAbi,
  chogStateAbi,
  DEFAULT_MAX_GAS_FEE,
  NICKNAME_MAX,
  PERSONALITY_MAX,
  policyParams,
  normalizeProfileText,
  type Deployment,
  type PolicyPresetKey,
} from "@chog-world/shared";
import { api, type ChogView } from "@/lib/api";
import { chog as fmtChog, untilLabel } from "@/lib/format";
import { gasTank, mon } from "@/lib/gas";
import { GasTopUp } from "./GasTopUp";
import { GrudgePicker } from "./GrudgePicker";
import { useTx, type TxState } from "@/hooks/useTx";
import { useSaveProfile } from "@/hooks/useSaveProfile";
import { TxStatus } from "./TxStatus";
import { GoalPicker, PresetPicker, presetOf } from "./PolicyPickers";

const CHECK_IN_INTERVAL = 20 * 3600;
const STREAK_WINDOW = 48 * 3600;

type Tab = "daily" | "agent" | "wallet" | "profile";
const TABS: { id: Tab; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "agent", label: "Agent" },
  { id: "wallet", label: "Wallet" },
  { id: "profile", label: "Profile" },
];

/** Everything the owner can do for their Chog. Only rendered for the connected owner. */
export function OwnerPanel({ chog, deployment }: { chog: ChogView; deployment: Deployment }) {
  const [tab, setTab] = useState<Tab>("daily");
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["chog", chog.tokenId] });
    void qc.invalidateQueries({ queryKey: ["journal", chog.tokenId] });
  };

  return (
    <section className="sticker overflow-hidden bg-night-2" aria-labelledby="owner-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-ink px-5 pt-4">
        <h2 id="owner-title" className="pb-3 font-display text-2xl">
          Your controls
        </h2>
        <div role="tablist" aria-label="Owner controls" className="-mb-[3px] flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`rounded-t-xl border-[3px] px-3 py-1.5 text-sm font-bold transition-colors ${
                tab === t.id ? "border-ink border-b-night-2 bg-night-2 text-paper" : "border-transparent text-muted hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "daily" && <DailyTab chog={chog} deployment={deployment} onDone={refresh} />}
        {tab === "agent" && <AgentTab chog={chog} deployment={deployment} onDone={refresh} />}
        {tab === "wallet" && <WalletTab chog={chog} deployment={deployment} onDone={refresh} />}
        {tab === "profile" && <ProfileTab chog={chog} onDone={refresh} />}
      </div>
    </section>
  );
}

function busy(s: TxState) {
  return s.status === "signing" || s.status === "pending";
}

function ActionButton({
  children,
  tone = "gold",
  pending,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "gold" | "plain" | "danger"; pending?: boolean }) {
  const tones = {
    gold: "bg-gold text-ink",
    plain: "bg-night-3 text-paper",
    danger: "bg-danger text-ink",
  };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || pending}
      className={`rounded-xl border-[3px] border-ink px-4 py-2 font-display text-base shadow-[3px_3px_0_0_var(--ink)] transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Daily: check-in streak
// ---------------------------------------------------------------------------

function DailyTab({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const now = Date.now() / 1000;
  const last = chog.character.lastCheckIn;
  const nextAt = last ? last + CHECK_IN_INTERVAL : 0;
  const ready = now >= nextAt;
  const streakAlive = last !== 0 && now <= last + STREAK_WINDOW;
  const streak = streakAlive ? chog.character.streak : 0;
  const buffed = chog.character.buffUntil > now;

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-center gap-1.5" aria-label={`Streak: ${streak} of 7 days`}>
        {Array.from({ length: 7 }, (_, i) => (
          <span
            key={i}
            className={`grid size-8 place-items-center rounded-lg border-2 border-ink text-xs font-bold ${
              i < streak ? "bg-gold text-ink shadow-[2px_2px_0_0_var(--ink)]" : "bg-night text-muted"
            }`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted">
          Check in once a day for +10 XP and a 24-hour <span className="text-paper">+50% XP</span> boost. Seven days in a row earns the{" "}
          <span className="text-gold">Devoted</span> trophy. Miss two days and the streak resets.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            disabled={!ready}
            pending={busy(tx.state)}
            onClick={async () => {
              const ok = await tx.run(() =>
                writeContractAsync({ address: deployment.state, abi: chogStateAbi, functionName: "checkIn", args: [deployment.collection, BigInt(chog.tokenId)] }),
              );
              if (ok) onDone();
            }}
          >
            {ready ? "Check in" : `Next check-in in ${untilLabel(nextAt)}`}
          </ActionButton>
          {buffed && <span className="rounded-full bg-monad/25 px-2.5 py-1 text-xs font-bold text-monad">Boost active · {untilLabel(chog.character.buffUntil)} left</span>}
        </div>
        <TxStatus state={tx.state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent: pause, goals and budget, permission, stop
// ---------------------------------------------------------------------------

function AgentTab({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const pauseTx = useTx();
  const goalsTx = useTx();
  const policyTx = useTx();
  const grantTx = useTx();
  const stopTx = useTx();
  const revokeTx = useTx();
  const [goals, setGoals] = useState(chog.character.goalMask);
  const current = presetOf(chog.policy);
  const [preset, setPreset] = useState<PolicyPresetKey | null>(current);
  const [confirmStop, setConfirmStop] = useState(false);
  const collection = deployment.collection;
  const tokenId = BigInt(chog.tokenId);

  const permission = useReadContract({
    address: chog.account,
    abi: accountV3Abi,
    functionName: "permissions",
    args: [address!, deployment.operator],
    query: { enabled: !!address && chog.accountDeployed },
  });
  const granted = permission.data === true;
  const paused = chog.policy.paused;
  const tank = gasTank(chog);
  // Saving a budget keeps the owner's gas limit; a Chog enrolled before gas fees gets the default.
  const maxGasFee = BigInt(chog.policy.maxGasFee) > 0n ? BigInt(chog.policy.maxGasFee) : DEFAULT_MAX_GAS_FEE;
  const gasLimitTx = useTx();

  return (
    <div className="space-y-6">
      {!granted && permission.isSuccess && (
        <div className="rounded-2xl border-[3px] border-danger/60 bg-danger/10 p-4">
          <p className="font-bold">The agent can&apos;t act: its permission on the Chog&apos;s wallet was removed.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionButton
              pending={busy(grantTx.state)}
              onClick={async () => {
                const ok = await grantTx.run(() =>
                  writeContractAsync({ address: chog.account, abi: accountV3Abi, functionName: "setPermissions", args: [[deployment.operator], [true]] }),
                );
                if (ok) {
                  await permission.refetch();
                  onDone();
                }
              }}
            >
              Allow the agent again
            </ActionButton>
            <TxStatus state={grantTx.state} />
          </div>
        </div>
      )}

      {tank.overLimit && (
        <div className="rounded-2xl border-[3px] border-gold/60 bg-gold/10 p-4">
          <p className="font-bold">Moves now cost up to {mon(tank.maxFee)} MON in gas, more than the {mon(chog.policy.maxGasFee)} MON per move you allowed.</p>
          <p className="mt-1 text-sm text-muted">Your Chog rests until you allow it. It pays from its own wallet, never from yours.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionButton
              pending={busy(gasLimitTx.state)}
              onClick={async () => {
                const limit = tank.maxFee > DEFAULT_MAX_GAS_FEE ? tank.maxFee : DEFAULT_MAX_GAS_FEE;
                const ok = await gasLimitTx.run(() =>
                  writeContractAsync({
                    address: deployment.operator,
                    abi: chogOperatorAbi,
                    functionName: "updatePolicy",
                    args: [collection, tokenId, { ...currentParams(chog), maxGasFee: limit }],
                  }),
                );
                if (ok) {
                  await api.nudge(chog.tokenId).catch(() => undefined);
                  onDone();
                }
              }}
            >
              Allow up to {mon(tank.maxFee > DEFAULT_MAX_GAS_FEE ? tank.maxFee : DEFAULT_MAX_GAS_FEE)} MON per move
            </ActionButton>
            <TxStatus state={gasLimitTx.state} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-xl">{paused ? "Agent paused" : "Agent running"}</p>
          <p className="text-sm text-muted">{paused ? "It won't make any moves until you resume it." : "Pausing stops new moves; anything already running finishes."}</p>
        </div>
        <ActionButton
          tone={paused ? "gold" : "plain"}
          pending={busy(pauseTx.state)}
          onClick={async () => {
            const ok = await pauseTx.run(() =>
              writeContractAsync({ address: deployment.operator, abi: chogOperatorAbi, functionName: "setPaused", args: [collection, tokenId, !paused] }),
            );
            if (ok) {
              if (paused) await api.nudge(chog.tokenId).catch(() => undefined);
              onDone();
            }
          }}
        >
          {paused ? "Resume" : "Pause"}
        </ActionButton>
      </div>
      <TxStatus state={pauseTx.state} />

      <div className="space-y-3 border-t-2 border-night-3 pt-5">
        <GoalPicker value={goals} onChange={setGoals} />
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            disabled={goals === chog.character.goalMask}
            pending={busy(goalsTx.state)}
            onClick={async () => {
              const ok = await goalsTx.run(() =>
                writeContractAsync({ address: deployment.state, abi: chogStateAbi, functionName: "setGoals", args: [collection, tokenId, goals] }),
              );
              if (ok) onDone();
            }}
          >
            Save goals
          </ActionButton>
          <TxStatus state={goalsTx.state} />
        </div>
      </div>

      <div className="border-t-2 border-night-3 pt-5">
        <GrudgePicker chog={chog} onDone={onDone} />
      </div>

      <div className="space-y-3 border-t-2 border-night-3 pt-5">
        <PresetPicker value={preset} onChange={setPreset} name="owner-preset" />
        {!current && <p className="text-xs text-muted">Current limits are custom: {fmtChog(chog.policy.dailyCap)} CHOG a day.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            disabled={!preset || preset === current}
            pending={busy(policyTx.state)}
            onClick={async () => {
              if (!preset) return;
              const ok = await policyTx.run(() =>
                writeContractAsync({
                  address: deployment.operator,
                  abi: chogOperatorAbi,
                  functionName: "updatePolicy",
                  args: [collection, tokenId, policyParams(preset, maxGasFee)],
                }),
              );
              if (ok) onDone();
            }}
          >
            Save budget
          </ActionButton>
          <TxStatus state={policyTx.state} />
        </div>
      </div>

      <div className="space-y-3 border-t-2 border-night-3 pt-5">
        <p className="font-display text-xl text-danger">Stop the agent</p>
        <p className="text-sm text-muted">
          Ends this agent&apos;s policy for good. Your Chog keeps everything it owns, and you can awaken its agent again later with new settings.
        </p>
        {!confirmStop ? (
          <ActionButton tone="plain" onClick={() => setConfirmStop(true)}>
            Stop the agent…
          </ActionButton>
        ) : (
          <div className="space-y-3 rounded-2xl border-[3px] border-danger/60 bg-danger/10 p-4">
            <p className="font-bold">Stop {chog.profile?.nickname ?? `Chog #${chog.tokenId}`}&apos;s agent?</p>
            <div className="flex flex-wrap gap-3">
              <ActionButton
                tone="danger"
                pending={busy(stopTx.state)}
                onClick={async () => {
                  const ok = await stopTx.run(() =>
                    writeContractAsync({ address: deployment.operator, abi: chogOperatorAbi, functionName: "revoke", args: [collection, tokenId] }),
                  );
                  if (ok) {
                    setConfirmStop(false);
                    onDone();
                  }
                }}
              >
                Yes, stop it
              </ActionButton>
              <ActionButton tone="plain" onClick={() => setConfirmStop(false)}>
                Keep it running
              </ActionButton>
            </div>
            <TxStatus state={stopTx.state} />
          </div>
        )}
        {granted && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy(revokeTx.state)}
              onClick={async () => {
                const ok = await revokeTx.run(() =>
                  writeContractAsync({ address: chog.account, abi: accountV3Abi, functionName: "setPermissions", args: [[deployment.operator], [false]] }),
                );
                if (ok) {
                  await permission.refetch();
                  onDone();
                }
              }}
              className="text-sm font-bold text-muted underline decoration-dotted underline-offset-4 hover:text-paper disabled:opacity-50"
            >
              Also remove its permission on the Chog&apos;s wallet
            </button>
            <TxStatus state={revokeTx.state} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallet: top up and withdraw
// ---------------------------------------------------------------------------

function useAmount(initial: string) {
  const [amount, setAmount] = useState(initial);
  const wei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);
  return { amount, setAmount: (v: string) => setAmount(v.replace(/[^\d.]/g, "")), wei };
}

/** The Chog's policy as it stands onchain, as ChogOperator.PolicyParams. */
function currentParams(chog: ChogView) {
  return {
    expiry: BigInt(chog.policy.expiry),
    actionMask: chog.policy.actionMask,
    maxActionsPerDay: chog.policy.maxActionsPerDay,
    maxPerAction: BigInt(chog.policy.maxPerAction),
    dailyCap: BigInt(chog.policy.dailyCap),
    maxGasFee: BigInt(chog.policy.maxGasFee),
  };
}

function WalletTab({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const topUpTx = useTx();
  const withdrawTx = useTx();
  const top = useAmount("50");
  const out = useAmount("");
  const wallet = useReadContract({ address: deployment.chogToken, abi: erc20Abi, functionName: "balanceOf", args: [address!], query: { enabled: !!address } });
  const chogBalance = BigInt(chog.balance);
  const topTooMuch = wallet.data !== undefined && top.wei > wallet.data;
  const outTooMuch = out.wei > chogBalance;
  const tank = gasTank(chog);

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="space-y-3">
        <p className="font-display text-xl">Top up</p>
        <p className="text-sm text-muted">In your wallet: {wallet.data !== undefined ? `${fmtChog(wallet.data)} CHOG` : "…"}</p>
        <AmountInput label="Top-up amount" value={top.amount} onChange={top.setAmount} />
        {topTooMuch && <p className="text-sm text-danger">That is more than you have.</p>}
        <ActionButton
          disabled={top.wei === 0n || topTooMuch}
          pending={busy(topUpTx.state)}
          onClick={async () => {
            const ok = await topUpTx.run(() =>
              writeContractAsync({ address: deployment.chogToken, abi: erc20Abi, functionName: "transfer", args: [chog.account, top.wei] }),
            );
            if (ok) {
              void wallet.refetch();
              onDone();
            }
          }}
        >
          Send {top.amount || "0"} CHOG to {chog.profile?.nickname ?? `#${chog.tokenId}`}
        </ActionButton>
        <TxStatus state={topUpTx.state} />
      </div>

      <div className="space-y-3">
        <p className="font-display text-xl">Withdraw</p>
        <p className="text-sm text-muted">In its wallet: {fmtChog(chog.balance)} CHOG. Only you, as the owner, can move it.</p>
        <div className="flex items-center gap-2">
          <AmountInput label="Withdraw amount" value={out.amount} onChange={out.setAmount} />
          <button type="button" onClick={() => out.setAmount(fmtChog(chog.balance, 18).replace(/,/g, ""))} className="text-sm font-bold text-gold underline decoration-dotted underline-offset-4">
            Max
          </button>
        </div>
        {outTooMuch && <p className="text-sm text-danger">It only has {fmtChog(chog.balance)} CHOG.</p>}
        <ActionButton
          tone="plain"
          disabled={out.wei === 0n || outTooMuch}
          pending={busy(withdrawTx.state)}
          onClick={async () => {
            // The owner drives the Chog's own wallet directly; no CHOG World contract is involved.
            const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [address!, out.wei] });
            const ok = await withdrawTx.run(() =>
              writeContractAsync({ address: chog.account, abi: accountV3Abi, functionName: "execute", args: [deployment.chogToken, 0n, data, 0] }),
            );
            if (ok) {
              out.setAmount("");
              void wallet.refetch();
              onDone();
            }
          }}
        >
          Withdraw {out.amount || "0"} CHOG to you
        </ActionButton>
        <TxStatus state={withdrawTx.state} />
      </div>

      {tank.charges && (
        <div className="space-y-3 border-t-2 border-night-3 pt-5 sm:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-xl">Gas tank</p>
            <p className="text-sm text-muted">
              {mon(tank.balance)} MON · about {Number.isFinite(tank.moves) ? tank.moves : "∞"} quests at {mon(tank.questFee)} MON each
            </p>
          </div>
          <p className="text-sm text-muted">
            Each move pays the network fee from your Chog&apos;s own MON. When it runs dry, your Chog rests until you top it up.
          </p>
          <GasTopUp chog={chog} onDone={onDone} />
        </div>
      )}
    </div>
  );
}

function AmountInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 rounded-xl border-[3px] border-ink bg-night px-3 py-1.5 font-mono"
      />
      <span className="font-bold">CHOG</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Profile: signed nickname and personality
// ---------------------------------------------------------------------------

function ProfileTab({ chog, onDone }: { chog: ChogView; onDone: () => void }) {
  const { state, save } = useSaveProfile(chog.tokenId);
  const [nickname, setNickname] = useState(chog.profile?.nickname ?? "");
  const [personality, setPersonality] = useState(chog.profile?.personality ?? "");
  const n = normalizeProfileText(nickname) || null;
  const p = normalizeProfileText(personality) || null;
  const unchanged = n === (chog.profile?.nickname ?? null) && p === (chog.profile?.personality ?? null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save(nickname, personality)) onDone();
      }}
    >
      <p className="text-sm text-muted">
        Give your Chog a name and a personality. The personality colours how it talks in its journal; it never changes what it is allowed to do.
        Signing is free and sends nothing onchain.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">Nickname</span>
        <input
          value={nickname}
          maxLength={NICKNAME_MAX}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={`Chog #${chog.tokenId}`}
          className="w-full rounded-xl border-[3px] border-ink bg-night px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="mb-1 flex justify-between text-sm font-bold">
          Personality
          <span className="font-normal text-muted">
            {personality.length}/{PERSONALITY_MAX}
          </span>
        </span>
        <textarea
          value={personality}
          maxLength={PERSONALITY_MAX}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          placeholder="Greedy but cautious. Hates slime. Never backs down from a rival."
          className="w-full resize-none rounded-xl border-[3px] border-ink bg-night px-3 py-2"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton type="submit" disabled={unchanged} pending={state.status === "signing" || state.status === "saving"}>
          Sign and save
        </ActionButton>
        <p className="text-sm" aria-live="polite">
          {state.status === "signing" && <span className="text-gold">Sign the message in your wallet…</span>}
          {state.status === "saving" && <span className="text-muted">Saving…</span>}
          {state.status === "saved" && <span className="text-mint">Saved.</span>}
          {state.status === "error" && <span className="text-danger">{state.message}</span>}
        </p>
      </div>
    </form>
  );
}
