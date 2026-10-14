import { formatUnits } from "viem";

/** CHOG amounts: whole numbers stay whole, fractions keep at most 2 decimals. */
export function chog(wei: string | bigint, digits = 2): string {
  const s = formatUnits(BigInt(wei), 18);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  return `${Number(i).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function untilLabel(unixSeconds: number, nowSeconds = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(unixSeconds - nowSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
