import type { TxState } from "@/hooks/useTx";
import { explorerTx } from "@/lib/config";

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  if (state.status === "signing") return <p className="text-sm text-gold">Waiting for your wallet…</p>;
  if (state.status === "error") return <p className="text-sm text-danger" role="alert">{state.message}</p>;
  const url = explorerTx(state.hash);
  const short = `${state.hash.slice(0, 10)}…${state.hash.slice(-6)}`;
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {state.status === "pending" ? "Confirming on Monad… " : "Confirmed. "}
      {url ? (
        <a className="font-mono text-paper underline decoration-dotted underline-offset-2" href={url} target="_blank" rel="noreferrer">
          {short}
        </a>
      ) : (
        <span className="font-mono text-paper">{short}</span>
      )}
    </p>
  );
}
