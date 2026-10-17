import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop, C, Sticker, Tag, body, display, mono, usePop, useProgress } from "./brand";
import manifest from "../public/voiceover/manifest.json";

/**
 * CHOG World motion intro at 30 fps. Scene lengths are worked out from the voiceover itself
 * (public/voiceover/manifest.json): each scene opens, its line starts LEAD frames later, and the
 * next scene follows TAIL frames after the line ends, so the narration stays compact. Each scene
 * also has a minimum length so its animation always has room to play.
 */
export const FPS = 30;
const LEAD = 8;
const TAIL = 6;
/** How long the logo holds after the last line. */
const HOLD = 30;

const ORDER = [
  { name: "plain", vo: "intro-01", min: 56 },
  { name: "wallet", vo: "intro-02", min: 60 },
  { name: "awake", vo: "intro-03", min: 80 },
  { name: "lives", vo: "intro-04", min: 130 },
  { name: "grows", vo: "intro-05", min: 100 },
  { name: "moves", vo: "intro-06", min: 84 },
  { name: "logo", vo: "intro-07", min: 0 },
] as const;

type SceneName = (typeof ORDER)[number]["name"];
type Timing = { from: number; to: number; vo: { id: string; at: number } };

function timeline(): { scenes: Record<SceneName, Timing>; duration: number } {
  const scenes = {} as Record<SceneName, Timing>;
  let t = 0;
  for (const s of ORDER) {
    const line = (manifest as Record<string, { seconds: number }>)[s.vo];
    if (!line) throw new Error(`voiceover line ${s.vo} is missing; run pnpm voiceover`);
    const vo = Math.ceil(line.seconds * FPS);
    const length = Math.max(s.min, LEAD + vo + (s.name === "logo" ? HOLD : TAIL));
    scenes[s.name] = { from: t, to: t + length, vo: { id: s.vo, at: t + LEAD } };
    t += length;
  }
  return { scenes, duration: t };
}

const { scenes: SCENES, duration } = timeline();
export const DURATION = duration;

/** Layout helpers: everything is sized in units of the short side, so 16:9, 1:1 and 9:16 all work. */
function useLayout() {
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  return { width, height, u, wide: width / height > 1.3, tall: height / width > 1.3 };
}

function Center({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...style }}>{children}</AbsoluteFill>;
}

/** The Chog card: its picture in a sticker frame, with an optional caption bar. */
function ChogCard({ src, size, caption, style }: { src: string; size: number; caption?: ReactNode; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <Sticker radius={40 * u} border={8 * u} shadow={16 * u} style={{ width: size, ...style }}>
      <Img src={staticFile(src)} style={{ width: size - 16 * u, height: size - 16 * u, display: "block" }} />
      {caption && (
        <div style={{ borderTop: `${6 * u}px solid ${C.ink}`, padding: `${14 * u}px ${22 * u}px`, fontFamily: display, fontSize: 40 * u, color: C.paper, display: "flex", justifyContent: "space-between" }}>
          {caption}
        </div>
      )}
    </Sticker>
  );
}

// ---------------------------------------------------------------------------
// 1. "This is a Chog."
// ---------------------------------------------------------------------------
function ScenePlain() {
  const { u } = useLayout();
  const card = usePop(4);
  const label = usePop(22);
  return (
    <Center style={{ flexDirection: "column", gap: 34 * u }}>
      <div style={card.style}>
        <ChogCard src="art/chog-plain.png" size={560 * u} />
      </div>
      <div style={{ ...label.style, fontFamily: mono, fontSize: 30 * u, color: C.muted, letterSpacing: 2 }}>CHOG GENESIS #1462</div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 2. "Right now, it just sits in your wallet."
// ---------------------------------------------------------------------------
function Dust() {
  const frame = useCurrentFrame();
  const { width, height, u } = useLayout();
  return (
    <AbsoluteFill>
      {Array.from({ length: 14 }, (_, i) => {
        const x = ((i * 137) % 100) / 100;
        const y = ((i * 71) % 100) / 100;
        const drift = (frame * (0.3 + (i % 4) * 0.12)) % height;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x * width,
              top: (y * height + drift) % height,
              width: (4 + (i % 3) * 3) * u,
              height: (4 + (i % 3) * 3) * u,
              borderRadius: 99,
              background: C.muted,
              opacity: 0.18,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function SceneWallet() {
  const { u } = useLayout();
  const chip = usePop(14);
  const fade = useProgress(0, 40);
  return (
    <>
      <Dust />
      <Center style={{ flexDirection: "column", gap: 34 * u }}>
        <div style={{ transform: `scale(${1 - 0.06 * fade})`, filter: `grayscale(${0.75 * fade}) brightness(${1 - 0.25 * fade})` }}>
          <ChogCard src="art/chog-plain.png" size={560 * u} />
        </div>
        <div style={chip.style}>
          <Sticker bg={C.night3} radius={999} border={5 * u} shadow={7 * u} style={{ padding: `${14 * u}px ${30 * u}px`, display: "flex", gap: 14 * u, alignItems: "center" }}>
            <span style={{ fontSize: 34 * u }}>👛</span>
            <span style={{ fontFamily: body, fontWeight: 600, fontSize: 32 * u, color: C.muted }}>in a wallet · doing nothing</span>
          </Sticker>
        </div>
      </Center>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. "CHOG World gives it a wallet, and a mind of its own."
// ---------------------------------------------------------------------------
function Burst({ at }: { at: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const t = interpolate(frame, [at, at + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (t <= 0 || t >= 1) return null;
  return (
    <Center>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 10 * u,
            height: 70 * u,
            borderRadius: 99,
            background: i % 2 ? C.gold : C.monad,
            transform: `rotate(${i * 30}deg) translateY(${-(330 + 160 * t) * u}px) scaleY(${1 - t})`,
            opacity: 1 - t,
          }}
        />
      ))}
    </Center>
  );
}

function Badge({ icon, text, color, delay, style }: { icon: string; text: string; color: string; delay: number; style: CSSProperties }) {
  const { u } = useLayout();
  const pop = usePop(delay, { damping: 11 });
  return (
    <div style={{ position: "absolute", ...style, ...pop.style }}>
      <Sticker bg={color} radius={999} border={6 * u} shadow={9 * u} style={{ padding: `${16 * u}px ${30 * u}px`, display: "flex", gap: 14 * u, alignItems: "center" }}>
        <span style={{ fontSize: 40 * u }}>{icon}</span>
        <span style={{ fontFamily: display, fontSize: 40 * u, color: C.ink }}>{text}</span>
      </Sticker>
    </div>
  );
}

function SceneAwake() {
  const { u, wide } = useLayout();
  const reveal = useProgress(18, 34);
  const size = 560 * u;
  return (
    <>
      <Burst at={16} />
      <Center>
        <div style={{ position: "relative", width: size, height: size }}>
          <div style={{ position: "absolute", inset: 0, filter: `grayscale(${0.75 * (1 - reveal)}) blur(${(1 - reveal) * 3}px)` }}>
            <ChogCard src="art/chog-plain.png" size={size} />
          </div>
          <div style={{ position: "absolute", inset: 0, opacity: reveal, filter: `blur(${(1 - reveal) * 6}px)` }}>
            <ChogCard src="art/chog-lv1.png" size={size} />
          </div>
          <Badge icon="👛" text="its own wallet" color={C.gold} delay={30} style={wide ? { left: -380 * u, top: 120 * u } : { left: -60 * u, top: -120 * u }} />
          <Badge icon="🧠" text="a mind of its own" color={C.monad} delay={52} style={wide ? { right: -440 * u, top: 330 * u } : { right: -60 * u, bottom: -120 * u }} />
        </div>
      </Center>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. "It quests, picks fights with rivals, and earns. All on its own, inside the limits you set."
// ---------------------------------------------------------------------------
function Typewriter({ text, start, cps = 32 }: { text: string; start: number; cps?: number }) {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor(((frame - start) / 30) * cps));
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && n > 0 ? <span style={{ color: C.monad }}>▍</span> : null}
    </>
  );
}

function Moment({ tag, color, delay, children }: { tag: string; color: string; delay: number; children: ReactNode }) {
  const { u, wide } = useLayout();
  const pop = usePop(delay);
  return (
    <div style={{ ...pop.style, transform: `${pop.style.transform} translateX(${(1 - pop.p) * 40 * u}px)` }}>
      <Sticker radius={28 * u} border={6 * u} shadow={11 * u} style={{ padding: `${24 * u}px ${30 * u}px`, display: "flex", gap: 22 * u, alignItems: "center", width: (wide ? 1000 : 940) * u }}>
        <Tag color={color}>{tag}</Tag>
        <span style={{ fontFamily: body, fontWeight: 600, fontSize: (wide ? 34 : 31) * u, color: C.paper, lineHeight: 1.25, whiteSpace: "nowrap" }}>{children}</span>
      </Sticker>
    </div>
  );
}

function SceneLives() {
  const { u, wide } = useLayout();
  const slide = useProgress(0, 22);
  const limits = usePop(96);
  return (
    <AbsoluteFill style={{ flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: 70 * u }}>
      <div style={{ transform: `translateX(${wide ? -40 * slide * u : 0}px) scale(${1 - 0.1 * slide})` }}>
        <ChogCard src="art/chog-lv1.png" size={500 * u} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 * u }}>
        <Moment tag="QUEST" color={C.gold} delay={10}>
          Cleared Slime Pit: +20 XP, +5.4 CHOG
        </Moment>
        <Moment tag="ARENA" color={C.danger} delay={32}>
          Beat Chog #2 in the Arena (+14 rep)
        </Moment>
        <Moment tag="THINKS" color={C.monad} delay={54}>
          <span style={{ fontStyle: "italic" }}>
            “<Typewriter text="Time to settle the score with Chog #2!" start={60} cps={40} />”
          </span>
        </Moment>
        <div style={{ ...limits.style, display: "flex", gap: 14 * u, alignItems: "center", fontFamily: body, fontWeight: 600, fontSize: 30 * u, color: C.mint, paddingLeft: 8 * u }}>
          🔒 150 CHOG a day · 6 moves · enforced onchain
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// 5. "Every win, every scar, every title becomes part of it."
// ---------------------------------------------------------------------------
const STAGES = [
  { src: "art/chog-lv1.png", level: 1 },
  { src: "art/chog-lv6.png", level: 6 },
  { src: "art/chog-lv12.png", level: 12 },
  { src: "art/chog-lv22.png", level: 22 },
];

function SceneGrows() {
  const frame = useCurrentFrame();
  const { u, wide } = useLayout();
  const size = (wide ? 620 : 520) * u;
  // Four stages across the scene; each crossfades in with a quick blur.
  const stageAt = [0, 24, 48, 72];
  const level = Math.round(interpolate(frame, [0, 84], [1, 22], { extrapolateRight: "clamp", easing: (t) => 1 - Math.pow(1 - t, 2) }));
  const titles = [
    { text: "Explorer", at: 24 },
    { text: "Giant Slayer", at: 48 },
    { text: "Unbroken", at: 72 },
  ];
  return (
    <AbsoluteFill style={{ flexDirection: wide ? "row" : "column", alignItems: "center", justifyContent: "center", gap: (wide ? 80 : 36) * u }}>
      <div style={{ position: "relative", width: size, height: size }}>
        {STAGES.map((s, i) => {
          const t = interpolate(frame, [stageAt[i]!, stageAt[i]! + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={s.src} style={{ position: "absolute", inset: 0, opacity: i === 0 ? 1 : t, filter: `blur(${(1 - t) * (i === 0 ? 0 : 6)}px)` }}>
              <ChogCard src={s.src} size={size} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 * u, alignItems: wide ? "flex-start" : "center" }}>
        <div style={{ fontFamily: display, fontSize: (wide ? 150 : 110) * u, lineHeight: 0.9, color: C.gold, textShadow: `${8 * u}px ${8 * u}px 0 ${C.ink}` }}>LV {level}</div>
        <div style={{ display: "flex", flexDirection: wide ? "column" : "row", gap: (wide ? 22 : 16) * u, alignItems: wide ? "flex-start" : "center" }}>
          {titles.map((t) => (
            <TitleRibbon key={t.text} text={t.text} at={t.at} compact={!wide} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function TitleRibbon({ text, at, compact = false }: { text: string; at: number; compact?: boolean }) {
  const { u } = useLayout();
  const pop = usePop(at, { damping: 10 });
  return (
    <div style={pop.style}>
      <Sticker bg={C.gold} radius={18 * u} border={6 * u} shadow={9 * u} style={{ padding: `${10 * u}px ${(compact ? 18 : 28) * u}px` }}>
        <span style={{ fontFamily: display, fontSize: (compact ? 34 : 46) * u, color: C.ink, whiteSpace: "nowrap" }}>★ {text}</span>
      </Sticker>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. "And everything it earns moves with the NFT."
// ---------------------------------------------------------------------------
function WalletPanel({ label, address, active, compact = false, style }: { label: string; address: string; active: boolean; compact?: boolean; style: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div style={{ position: "absolute", ...style }}>
      <Sticker bg={active ? C.night3 : C.night2} radius={30 * u} border={6 * u} shadow={10 * u} style={{ width: (compact ? 640 : 430) * u, height: (compact ? 560 : 640) * u, padding: 28 * u, boxSizing: "border-box", opacity: active ? 1 : 0.55 }}>
        <div style={{ fontFamily: display, fontSize: 44 * u, color: C.paper }}>{label}</div>
        <div style={{ fontFamily: mono, fontSize: 26 * u, color: C.muted, marginTop: 6 * u }}>{address}</div>
      </Sticker>
    </div>
  );
}

function SceneMoves() {
  const frame = useCurrentFrame();
  const { u, wide, tall, width } = useLayout();
  const t = interpolate(frame, [20, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) });
  // Side by side on wide and square frames; stacked on tall ones, where the Chog travels down.
  const gap = tall ? 420 * u : wide ? 560 * u : Math.min(300 * u, width * 0.28);
  const axis = tall ? "Y" : "X";
  const loot = ["164 CHOG", "Wyrmfang", "3 trophies"];
  return (
    <Center>
      <WalletPanel label="Seller" address="0x8CcF…6d94" active={t < 0.5} compact={tall} style={{ transform: `translate${axis}(${-gap}px)` }} />
      <WalletPanel label="Buyer" address="0x3Aa7…79EA" active={t >= 0.5} compact={tall} style={{ transform: `translate${axis}(${gap}px)` }} />
      <div
        style={{
          position: "absolute",
          transform: tall
            ? `translateX(${-110 * u}px) translateY(${interpolate(t, [0, 1], [-gap, gap]) + 40 * u}px) rotate(${Math.sin(t * Math.PI) * -6}deg)`
            : `translateX(${interpolate(t, [0, 1], [-gap, gap])}px) translateY(${-30 * u}px) rotate(${Math.sin(t * Math.PI) * -6}deg)`,
        }}
      >
        <ChogCard src="art/chog-lv22.png" size={300 * u} />
        {loot.map((l, i) => {
          const lag = interpolate(frame, [20 + (i + 1) * 5, 62 + (i + 1) * 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div
              key={l}
              style={{
                position: "absolute",
                // Below the card on wide frames; beside it on tall ones, where the panel is wider than deep.
                left: tall ? 324 * u : 0,
                top: tall ? 70 * u + i * 60 * u : 316 * u + i * 54 * u,
                transform: `translate${axis}(${(lag - t) * 2 * gap}px)`,
                fontFamily: body,
                fontWeight: 700,
                fontSize: 25 * u,
                color: C.ink,
                background: C.gold,
                border: `${4 * u}px solid ${C.ink}`,
                borderRadius: 999,
                padding: `${4 * u}px ${18 * u}px`,
                whiteSpace: "nowrap",
              }}
            >
              {l}
            </div>
          );
        })}
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------
// 7. "CHOG World. Every Chog has a look. Now give it a life."
// ---------------------------------------------------------------------------
function SceneLogo() {
  const { u } = useLayout();
  const icon = usePop(0, { damping: 10 });
  const word = usePop(10);
  const line1 = usePop(26);
  const line2 = usePop(44);
  const url = usePop(60);
  return (
    <Center style={{ flexDirection: "column", gap: 28 * u, textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 * u }}>
        <Img src={staticFile("brand/chog-icon.svg")} style={{ ...icon.style, width: 150 * u, height: 150 * u }} />
        <div style={{ ...word.style, fontFamily: display, fontSize: 130 * u, color: C.paper, textShadow: `${7 * u}px ${7 * u}px 0 ${C.ink}` }}>
          CHOG <span style={{ color: C.gold }}>WORLD</span>
        </div>
      </div>
      <div style={{ ...line1.style, fontFamily: display, fontSize: 64 * u, color: C.paper }}>Every Chog has a look.</div>
      <div style={{ ...line2.style, fontFamily: display, fontSize: 64 * u, color: C.paper }}>
        Now give it a <span style={{ color: C.gold }}>life.</span>
      </div>
      <div style={{ ...url.style, marginTop: 18 * u, fontFamily: mono, fontSize: 32 * u, color: C.ink, background: C.mint, border: `${5 * u}px solid ${C.ink}`, borderRadius: 999, padding: `${10 * u}px ${30 * u}px`, boxShadow: `${7 * u}px ${7 * u}px 0 0 ${C.ink}` }}>
        chog-world-mainnet.vercel.app
      </div>
    </Center>
  );
}

// ---------------------------------------------------------------------------

/** A scene with a short fade at each end, so cuts never feel like jumps. */
function Scene({ from, to, children }: { from: number; to: number; children: ReactNode }) {
  return (
    <Sequence from={from} durationInFrames={to - from} layout="none">
      <FadeEdges length={to - from}>{children}</FadeEdges>
    </Sequence>
  );
}

function FadeEdges({ length, children }: { length: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6, length - 6, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

export function Intro({ withVoiceover = true }: { withVoiceover?: boolean }) {
  return (
    <AbsoluteFill style={{ background: C.night, overflow: "hidden" }}>
      <Backdrop />
      <Scene {...SCENES.plain}>
        <ScenePlain />
      </Scene>
      <Scene {...SCENES.wallet}>
        <SceneWallet />
      </Scene>
      <Scene {...SCENES.awake}>
        <SceneAwake />
      </Scene>
      <Scene {...SCENES.lives}>
        <SceneLives />
      </Scene>
      <Scene {...SCENES.grows}>
        <SceneGrows />
      </Scene>
      <Scene {...SCENES.moves}>
        <SceneMoves />
      </Scene>
      <Scene {...SCENES.logo}>
        <SceneLogo />
      </Scene>
      {withVoiceover &&
        Object.values(SCENES).map(({ vo }) => (
          <Sequence key={vo.id} from={vo.at} layout="none">
            <Audio src={staticFile(`voiceover/${vo.id}.wav`)} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
