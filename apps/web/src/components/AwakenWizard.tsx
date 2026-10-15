"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, parseAbi, parseUnits, type Address } from "viem";
import {
  accountV3Abi,
  chogOperatorAbi,
  DEFAULT_MAX_GAS_FEE,
  Goal,
  NICKNAME_MAX,
  normalizeProfileText,
  PERSONALITY_MAX,
  policyParams,
  type Deployment,
  type PolicyPresetKey,
} from "@chog-world/shared";
import { api, type ChogView } from "@/lib/api";
import { isTestnet } from "@/lib/config";
import { useWorldConfig } from "@/hooks/useWorld";
import { chog as fmtChog } from "@/lib/format";
import { gasTank, isFunded, mon } from "@/lib/gas";
import { GasTopUp } from "./GasTopUp";
import { useSaveProfile } from "@/hooks/useSaveProfile";
import { useTx } from "@/hooks/useTx";
import { TxStatus } from "./TxStatus";
import { GoalPicker, PresetPicker } from "./PolicyPickers";

const faucetAbi = parseAbi(["function faucet(address to)"]);

type StepId = "account" | "permission" | "enroll" | "fund";
const STEPS: { id: StepId; title: string; blurb: string }[] = [
  { id: "account", title: "Give it a wallet", blurb: "Your Chog gets its own wallet, bound to the NFT. It will hold its coins, gear and trophies." },
  { id: "permission", title: "Let it act", blurb: "Allow CHOG World's rule contract to act for your Chog. Never our server, and you can revoke it any time." },
  { id: "enroll", title: "Name, goals and budget", blurb: "Name it, tell it what to chase and how much it may spend per day. The limits are enforced onchain." },
  { id: "fund", title: "Fund it", blurb: "Send it CHOG for quest and arena fees, and a little MON so it pays its own gas. Whatever it earns stays in its wallet." },
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
  const funded = isFunded(chog);
  const done: Record<StepId, boolean> = {
    account: chog.accountDeployed,
    permission: permission.data === true,
    enroll: enrolled,
    fund: funded,
  };
  const current = STEPS.find((s) => !done[s.id])?.id;
  // Creating the wallet is free (sponsored); the other steps each need one signature.
  const signaturesLeft = STEPS.filter((s) => s.id !== "account" && !done[s.id]).length;
  const name = chog.profile?.nickname ?? `Chog #${chog.tokenId}`;
  const returning = chog.character.awakened;
  const pilot = useWorldConfig().data?.pilot;
  const pilotFull = !!pilot && pilot.joined >= pilot.max && !chog.agent?.inPilot;

  return (
    <section className="sticker bg-night-2 p-6 sm:p-8" aria-labelledby="awaken-title">
      <h2 id="awaken-title" className="font-display text-4xl">
        {returning ? `Wake ${name}'s agent` : `Awaken ${name}`}
      </h2>
      <p className="mt-2 text-muted">
        {signaturesLeft === 1 ? "One signature" : `${signaturesLeft} signatures`} and it starts living on its own. You can stop here and come back:
        progress is saved onchain.
      </p>

      {pilotFull && (
        <p className="mt-4 rounded-xl border-2 border-gold/60 bg-gold/10 px-4 py-3 text-sm">
          <span className="font-bold text-gold">The pilot is full.</span> The first {pilot!.max} Chogs are playing right now. You can still awaken yours,
          but its agent won&apos;t act until a place opens, so hold off on funding it.
        </p>
      )}

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

function EnrollStep({ chog, deployment, onDone }: { chog: ChogView; deployment: Deployment; onDone: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const tx = useTx();
  const [goals, setGoals] = useState<number>(Goal.MONEY | Goal.STRONGEST);
  const [preset, setPreset] = useState<PolicyPresetKey>("BALANCED");
  const [nickname, setNickname] = useState(chog.profile?.nickname ?? "");
  const [personality, setPersonality] = useState(chog.profile?.personality ?? "");
  const profile = useSaveProfile(chog.tokenId);
  const tank = gasTank(chog);
  const profileChanged =
    (normalizeProfileText(nickname) || null) !== (chog.profile?.nickname ?? null) ||
    (normalizeProfileText(personality) || null) !== (chog.profile?.personality ?? null);
  const working = tx.state.status === "signing" || tx.state.status === "pending" || tx.state.status === "done";
  const savingProfile = profile.state.status === "signing" || profile.state.status === "saving";

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="mb-2 font-bold">
          Name it <span className="font-normal text-muted">(optional, you can change it later)</span>
        </legend>
        <input
          aria-label="Nickname"
          value={nickname}
          maxLength={NICKNAME_MAX}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={`Chog #${chog.tokenId}`}
          className="w-full rounded-xl border-[3px] border-ink bg-night px-3 py-2"
        />
        <textarea
          aria-label="Personality"
          value={personality}
          maxLength={PERSONALITY_MAX}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          placeholder="Personality, e.g. Greedy but cautious. Hates slime. Never backs down from a rival."
          className="w-full resize-none rounded-xl border-[3px] border-ink bg-night px-3 py-2"
        />
        <p className="text-xs text-muted">The personality shapes how it thinks and talks. Saving it is a free signature, nothing onchain.</p>
      </fieldset>
      <GoalPicker value={goals} onChange={setGoals} />
      <PresetPicker value={preset} onChange={setPreset} />
      {tank.charges && (
        <p className="rounded-2xl border-2 border-night-3 bg-night p-4 text-sm text-muted">
          <span className="font-bold text-paper">It pays its own gas.</span> Every move costs the network about {mon(tank.questFee)} MON, paid from
          your Chog&apos;s wallet. You allow at most <span className="text-paper">{mon(DEFAULT_MAX_GAS_FEE)} MON per move</span>; the contract refuses
          anything higher.
        </p>
      )}

      <div className="space-y-2">
        <PrimaryButton
          busy={working || savingProfile}
          onClick={async () => {
            // The name is a free signature: save it first so a cancelled signature never strands an enrolled Chog nameless.
            if (profileChanged && !(await profile.save(nickname, personality))) return;
            const ok = await tx.run(() =>
              writeContractAsync({
                address: deployment.operator,
                abi: chogOperatorAbi,
                functionName: "enroll",
                args: [deployment.collection, BigInt(chog.tokenId), policyParams(preset), goals],
              }),
            );
            if (ok) onDone();
          }}
        >
          {profileChanged ? "Save name, goals and budget" : "Set goals and budget"}
        </PrimaryButton>
        <p className="text-sm" aria-live="polite">
          {profile.state.status === "signing" && <span className="text-gold">Sign the name in your wallet (free)…</span>}
          {profile.state.status === "error" && <span className="text-danger">{profile.state.message}</span>}
        </p>
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
  const tank = gasTank(chog);
  const hasChog = BigInt(chog.balance) > 0n;
  const needsGas = tank.charges && tank.balance < tank.maxFee;

  const missing = [!hasChog && "CHOG for its quest and arena fees", needsGas && "MON for its gas"].filter(Boolean);

  return (
    <div className="space-y-6">
      {missing.length > 0 && (
        <p className="rounded-xl border-2 border-gold/60 bg-gold/10 px-3 py-2 text-sm">
          <span className="font-bold text-gold">Still needed:</span> {missing.join(" and ")}. It can&apos;t make a move without {missing.length > 1 ? "both" : "it"}.
        </p>
      )}
      {tank.charges && <p className="text-sm font-bold text-paper">{hasChog ? "✓ " : ""}CHOG for fees</p>}
      {hasChog ? (
        <p className="text-sm text-muted">It has {fmtChog(chog.balance)} CHOG.</p>
      ) : (
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
                aria-label="Amount of CHOG to send"
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
            {!isTestnet && (
              <a
                href={`https://nad.fun/tokens/${deployment.chogToken}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl px-3 py-2 text-sm font-bold text-gold underline decoration-dotted underline-offset-4 hover:text-paper"
              >
                Buy $CHOG on nad.fun
              </a>
            )}
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
      )}
      {tank.charges && (
        <div className="space-y-3 border-t-2 border-night-3 pt-5">
          <p className="text-sm font-bold text-paper">
            {needsGas ? "" : "✓ "}MON for gas <span className="font-normal text-muted">· it has {mon(tank.balance)} MON</span>
          </p>
          {needsGas && (
            <GasTopUp
              chog={chog}
              onDone={async () => {
                await api.nudge(chog.tokenId).catch(() => undefined);
                onDone();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
