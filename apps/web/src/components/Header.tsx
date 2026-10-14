"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { isTestnet } from "@/lib/config";

const NAV = [
  { href: "/", label: "World" },
  { href: "/chogs", label: "My Chogs" },
  { href: "/arena", label: "Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b-[3px] border-ink bg-night/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="group flex items-center gap-2" aria-label="CHOG World home">
          <span className="sticker grid size-9 shrink-0 place-items-center bg-monad font-display text-lg text-paper transition-transform group-hover:-rotate-6 sm:size-10 sm:text-xl">
            C
          </span>
          <span className="whitespace-nowrap font-display text-xl tracking-wide sm:text-2xl">
            CHOG <span className="text-gold">WORLD</span>
          </span>
        </Link>
        {isTestnet && (
          <span className="hidden rounded-full border-2 border-gold/60 px-2 py-0.5 text-xs font-semibold text-gold sm:inline">
            testnet
          </span>
        )}
        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  active ? "bg-night-3 text-paper" : "text-muted hover:text-paper"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto shrink-0 md:ml-2">
          <ConnectButton label="Connect" chainStatus="icon" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "full" }} />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden" aria-label="Main mobile">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:text-paper">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
