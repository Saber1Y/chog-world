import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadLilita } from "@remotion/google-fonts/LilitaOne";
import { loadFont as loadRubik } from "@remotion/google-fonts/Rubik";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

/** The site's tokens (apps/web/src/app/globals.css), so the film and the product look like one thing. */
export const C = {
  night: "#120c22",
  night2: "#1b1430",
  night3: "#261c42",
  ink: "#0b0716",
  paper: "#fbf6ff",
  muted: "#b7a9d6",
  monad: "#836ef9",
  gold: "#ffd23f",
  mint: "#3ee089",
  danger: "#ff4d5e",
} as const;

export const display = loadLilita("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
export const body = loadRubik("normal", { weights: ["400", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["500"], subsets: ["latin"] }).fontFamily;

/**
 * Springy entrance from 92% scale and transparent: never from zero, settles quickly, slight
 * overshoot. Returns 0..1 progress plus ready-made transform/opacity.
 */
export function usePop(delay = 0, config: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 170, mass: 0.7, ...config } });
  return {
    p,
    style: { opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }), transform: `scale(${0.92 + 0.08 * p})` } as CSSProperties,
  };
}

/** 0..1 over a frame range, eased out (strong ease-out, matching the site's UI motion). */
export function useProgress(start: number, end: number) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return 1 - Math.pow(1 - t, 3);
}

/** The site's sticker: thick ink outline and a chunky offset shadow. */
export function Sticker({ children, style, bg = C.night2, radius = 36, border = 7, shadow = 14 }: {
  children: ReactNode;
  style?: CSSProperties;
  bg?: string;
  radius?: number;
  border?: number;
  shadow?: number;
}) {
  return (
    <div style={{ background: bg, border: `${border}px solid ${C.ink}`, borderRadius: radius, boxShadow: `${shadow}px ${shadow}px 0 0 ${C.ink}`, overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

/** A small pill label, like the journal tags on the site (QUEST, ARENA, THINKS). */
export function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      style={{
        fontFamily: body,
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: 3,
        color,
        border: `3px solid ${color}`,
        borderRadius: 999,
        padding: "6px 16px",
        background: `${color}22`,
      }}
    >
      {children}
    </span>
  );
}

/** The night background with the site's two soft glows; the glows drift very slowly. */
export function Backdrop({ tint = C.monad }: { tint?: string }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at ${15 + drift}% -10%, ${tint}48, transparent 45%), radial-gradient(circle at ${110 - drift}% 30%, ${C.gold}1a, transparent 40%), ${C.night}`,
      }}
    />
  );
}
