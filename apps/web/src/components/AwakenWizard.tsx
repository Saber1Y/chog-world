"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, parseAbi, parseUnits, type Address } from "viem";
import {
  accountV3Abi,
  chogOperatorAbi,
  ALL_ACTIONS,
  Goal,
  GOAL_LABELS,
  POLICY_PRESETS,
  type Deployment,
  type GoalKey,
  type PolicyPresetKey,
} from "@chog-world/shared";
import { api, type ChogView } from "@/lib/api";
import { isTestnet } from "@/lib/config";
import { chog as fmtChog } from "@/lib/format";
import { useTx } from "@/hooks/useTx";
import { TxStatus } from "./TxStatus";

const faucetAbi = parseAbi(["function faucet(address to)"]);

type StepId = "account" | "permission" | "enroll" | "fund";
const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: "account", title: "Give it a wallet", blurb: "Your Chog gets its own wallet, bound to the NFT. It will hold its coins, gear and trophies." },
  { id: "permission", title: "Let it act", blurb: "Allow CHOG World's rule contract to act for your Chog. Never our server, and you can revoke it any time." },
  { id: "enroll", title: "Goals and budget", blurb: "Tell it what to chase and how much it may spend per day. The limits are enforced onchain." },
  { id: "fund", title: "Fund it", blurb: "Send it some CHOG to pay quest and arena fees. Whatever it earns stays in its wallet." },
];

export function AwakenWizard({ chog, deployment }: { chog: ChogView; deployment: Deployment }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["chog", chog.tokenId] });

  const permission = useReadContract({
    address: chog.account,
    abi: accountV3Abi,
    functionName: "permissions",
    args: [address!, deployment.operator],
    query: { enabled: chog.accountDeployed && !!address },
  });

  const enrolled = chog.policy.active && chog.policy.owner.toLowerCase() === address?.toLowerCase();
  const funded = BigInt(chog.balance) > 0n;
  const done: Record<StepId, boolean> = {
    account: chog.accountDeployed,
    permission: permission.data === true,
    enroll: enrolled,
    fund: funded,
  };
  const current = STEPS.find((s) => !done[s.id])?.id;

  return (
    <section className="sticker bg-night-2 p-6 sm:p-8" aria-labelledby="awaken-title">
      <h2 id="awaken-title" className="font-display text-4xl">
        Awaken Chog #{chog.tokenId}
      </h2>
      <p className="mt-2 text-muted">Three signatures and it starts living on its own. You can stop here and come back: progress is saved onchain.</p>

      <ol className="mt-8 space-y-4">
        {STEPS.map((s, i) => {
          const state = done[s.id] ? "done" : s.id === current ? "current" : "todo";
          return (
            <li
              key={s.id}
              className={`rounded-2xl border-[3px] p-5 transition-colors ${
                state === "current" ? "border-gold bg-night-3" : state === "done" ? "border-mint/50 bg-night" : "border-night-3 bg-night/60 opacity-60"
              }`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <div className="flex items-start gap-4">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border-[3px] border-ink font-display text-lg ${
                    state === "done" ? "bg-mint text-ink" : state === "current" ? "bg-gold text-ink" : "bg-night-3"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-2xl">{s.title}</h3>
                  <p className="text-sm text-muted">{s.blurb}</p>
                  {state === "current" && (
                    <div className="mt-4">
                      {s.id === "account" && <AccountStep chog={chog} onDone={refresh} />}
                      {s.id === "permission" && (
                        <PermissionStep account={chog.account} operator={deployment.operator} onDone={() => permission.refetch()} />
                      )}
                      {s.id === "enroll" && <EnrollStep chog={chog} deployment={deployment} onDone={refresh} />}
                      {s.id === "fund" && <FundStep chog={chog} deployment={deployment} onDone={refresh} />}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PrimaryButton({ children, busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className="sticker press bg-gold px-5 py-2.5 font-display text-lg text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none"
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function AccountStep({ chog, onDone }: { chog: ChogView; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <PrimaryButton
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.createAccount(chog.tokenId);
            onDone();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Create its wallet (free)
      </PrimaryButton>
      <p className="text-xs text-muted">CHOG World pays for this one. It gives us no control over the wallet: only the NFT&apos;s owner controls it.</p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PermissionStep({ account, operator, onDone }: { account: Address; operator: Address; onDone: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  return (
    <div className="space-y-2">
      <PrimaryButton
        busy={tx.state.status === "signing" || tx.state.status === "pending" || tx.state.status === "done"}
        onClick={async () => {
          const ok = await tx.run(() =>
            writeContractAsync({ address: account, abi: accountV3Abi, functionName: "setPermissions", args: [[operator], [true]] }),
          );
          if (ok) onDone();
        }}
      >
        Allow the agent
      </PrimaryButton>
      <TxStatus state={tx.state} />
    </div>
  );
}

const GOAL_KEYS = Object.keys(Goal) as GoalKey[];
const PRESET_KEYS = Object.keys(POLICY_PRESETS) as PolicyPresetKey[];

function EnrollStep({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [goals, setGoals] = useState<number>(Goal.MONEY | Goal.STRONGEST);
  const [preset, setPreset] = useState<PolicyPresetKey>("BALANCED");
  const p = POLICY_PRESETS[preset];

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">It should…</legend>
        <div className="flex flex-wrap gap-2">
          {GOAL_KEYS.map((k) => {
            const on = (goals & Goal[k]) !== 0;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setGoals((g) => g ^ Goal[k])}
                className={`rounded-full border-[3px] border-ink px-4 py-2 text-sm font-bold transition-colors ${
                  on ? "bg-monad text-paper shadow-[3px_3px_0_0_var(--ink)]" : "bg-night text-muted hover:text-paper"
                }`}
              >
                {GOAL_LABELS[k]}
              </button>
            );
          })}
        </div>
        {goals === 0 && <p className="mt-2 text-xs text-muted">No goals: it will balance everything.</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-bold uppercase tracking-wider text-muted">Daily budget</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESET_KEYS.map((k) => {
            const v = POLICY_PRESETS[k];
            const on = k === preset;
            return (
              <label
                key={k}
                className={`cursor-pointer rounded-2xl border-[3px] border-ink p-4 transition-transform ${
                  on ? "-translate-y-0.5 bg-gold text-ink shadow-[4px_4px_0_0_var(--ink)]" : "bg-night hover:-translate-y-0.5"
                }`}
              >
                <input type="radio" name="preset" value={k} checked={on} onChange={() => setPreset(k)} className="sr-only" />
                <span className="font-display text-xl">{v.label}</span>
                <span className={`mt-1 block text-sm ${on ? "text-ink/80" : "text-muted"}`}>
                  {fmtChog(v.dailyCap)} CHOG a day
                  <br />
                  up to {fmtChog(v.maxPerAction)} per move, {v.maxActionsPerDay} moves
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2">
        <PrimaryButton
          busy={tx.state.status === "signing" || tx.state.status === "pending" || tx.state.status === "done"}
          onClick={async () => {
            const ok = await tx.run(() =>
              writeContractAsync({
                address: deployment.operator,
                abi: chogOperatorAbi,
                functionName: "enroll",
                args: [
                  deployment.collection,
                  BigInt(chog.tokenId),
                  { expiry: 0n, actionMask: ALL_ACTIONS, maxActionsPerDay: p.maxActionsPerDay, maxPerAction: p.maxPerAction, dailyCap: p.dailyCap },
                  goals,
                ],
              }),
            );
            if (ok) onDone();
          }}
        >
          Set goals and budget
        </PrimaryButton>
        <TxStatus state={tx.state} />
      </div>
    </div>
  );
}

const AMOUNTS = ["50", "100", "250"];

function FundStep({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const faucetTx = useTx();
  const [amount, setAmount] = useState("100");
  const wallet = useReadContract({ address: deployment.chogToken, abi: erc20Abi, functionName: "balanceOf", args: [address!], query: { enabled: !!address } });
  const wei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);
  const tooMuch = wallet.data !== undefined && wei > wallet.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(a)}
            className={`rounded-full border-[3px] border-ink px-4 py-1.5 font-bold ${amount === a ? "bg-monad" : "bg-night text-muted hover:text-paper"}`}
          >
            {a}
          </button>
        ))}
        <label className="flex items-center gap-2">
          <span className="sr-only">Custom amount</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="w-28 rounded-xl border-[3px] border-ink bg-night px-3 py-1.5 font-mono"
          />
          <span className="font-bold">CHOG</span>
        </label>
      </div>
      <p className="text-sm text-muted">
        In your wallet: {wallet.data !== undefined ? `${fmtChog(wallet.data)} CHOG` : "…"}
        {tooMuch && <span className="ml-2 text-danger">That is more than you have.</span>}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton
          disabled={wei === 0n || tooMuch}
          busy={tx.state.status === "signing" || tx.state.status === "pending" || tx.state.status === "done"}
          onClick={async () => {
            const ok = await tx.run(() =>
              writeContractAsync({ address: deployment.chogToken, abi: erc20Abi, functionName: "transfer", args: [chog.account, wei] }),
            );
            if (ok) {
              await api.nudge(chog.tokenId).catch(() => undefined);
              onDone();
            }
          }}
        >
          Send {amount || "0"} CHOG
        </PrimaryButton>
        {isTestnet && (
          <button
            type="button"
            disabled={faucetTx.state.status === "signing" || faucetTx.state.status === "pending"}
            onClick={async () => {
              const ok = await faucetTx.run(() => writeContractAsync({ address: deployment.chogToken, abi: faucetAbi, functionName: "faucet", args: [address!] }));
              if (ok) wallet.refetch();
            }}
            className="rounded-xl px-3 py-2 text-sm font-bold text-gold underline decoration-dotted underline-offset-4 hover:text-paper disabled:opacity-50"
          >
            Get 500 test CHOG
          </button>
        )}
      </div>
      <TxStatus state={tx.state} />
      <TxStatus state={faucetTx.state} />
    </div>
  );
}
