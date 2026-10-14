import { ELEMENTS, TITLE_LABELS, Title } from "@chog-world/shared";

/**
 * Overlay art for an evolved Chog, drawn as one SVG on a 1024x1024 canvas and composited over the
 * collection's shared image. Every Chog starts from the same picture; everything here comes from
 * its DNA and what it has done. Pure function of `ArtState`, so the same state always draws the same.
 *
 * Layout fits the shared art: the face sits in the middle (about x 313-813, y 387-767), so overlays
 * live at the edges and corners. Scars sit around the face, never on the eyes.
 */

export const CANVAS = 1024;

export interface ArtState {
  tokenId: string;
  nickname: string | null;
  /** DNA hue, 0..359: the Chog's signature colour. */
  hue: number;
  /** 0 Ember, 1 Moss, 2 Volt, 3 Tide. */
  element: number;
  level: number;
  scars: number;
  weaponTier: number;
  armorTier: number;
  titles: number;
  injured: boolean;
}

export const ELEMENT_COLORS = [
  { main: "#ff5a1f", glow: "#ffb347", name: ELEMENTS[0] },
  { main: "#2fbf5b", glow: "#9cf2a8", name: ELEMENTS[1] },
  { main: "#f2d518", glow: "#fff59e", name: ELEMENTS[2] },
  { main: "#1f8bff", glow: "#8fd0ff", name: ELEMENTS[3] },
] as const;

interface FrameTier {
  name: string;
  minLevel: number;
  width: number;
  stops: [string, string, string];
  studs: boolean;
  ornaments: boolean;
}

/** The frame gets grander as the Chog levels up. "mythic" uses the Chog's own DNA hue. */
export function frameTier(level: number, hue: number): FrameTier {
  const signature = `hsl(${hue} 85% 60%)`;
  if (level >= 35) return { name: "mythic", minLevel: 35, width: 34, stops: [signature, "#ffffff", signature], studs: true, ornaments: true };
  if (level >= 20) return { name: "gold", minLevel: 20, width: 30, stops: ["#8a5a00", "#ffd84a", "#b07900"], studs: true, ornaments: true };
  if (level >= 10) return { name: "silver", minLevel: 10, width: 26, stops: ["#6f7680", "#f2f5f8", "#8e959e"], studs: true, ornaments: false };
  if (level >= 5) return { name: "bronze", minLevel: 5, width: 22, stops: ["#6b3a12", "#e09a56", "#8a4b1a"], studs: false, ornaments: false };
  return { name: "plain", minLevel: 1, width: 16, stops: ["#2a2140", "#4b3a73", "#2a2140"], studs: false, ornaments: false };
}

/** Titles in display priority: the rarest one gets the ribbon. */
const TITLE_PRIORITY = [Title.UNBROKEN, Title.GIANT_SLAYER, Title.VETERAN, Title.EXPLORER, Title.DEVOTED, Title.FIRST_BLOOD];

export function headlineTitle(titles: number): string | null {
  for (const t of TITLE_PRIORITY) if (titles & (1 << t)) return TITLE_LABELS[t]?.name ?? null;
  return null;
}

/** Scar spots around the face, in the order they are earned. */
const SCAR_SPOTS = [
  { x: 382, y: 650, r: -28, kind: "slash" },
  { x: 560, y: 420, r: 0, kind: "plaster" },
  { x: 752, y: 655, r: 24, kind: "slash" },
  { x: 470, y: 760, r: -10, kind: "stitch" },
  { x: 690, y: 410, r: 18, kind: "stitch" },
] as const;

export function renderOverlay(s: ArtState): string {
  const el = ELEMENT_COLORS[s.element % 4]!;
  const frame = frameTier(s.level, s.hue);
  const signature = `hsl(${s.hue} 80% 55%)`;
  const signatureDark = `hsl(${s.hue} 70% 22%)`;
  const title = headlineTitle(s.titles);
  const label = s.nickname ? truncate(s.nickname, 16) : `Chog #${s.tokenId}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="56%" r="74%">
      <stop offset="60%" stop-color="#120c22" stop-opacity="0"/>
      <stop offset="100%" stop-color="#120c22" stop-opacity="0.55"/>
    </radialGradient>
    <filter id="elementGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${frame.stops[0]}"/>
      <stop offset="50%" stop-color="${frame.stops[1]}"/>
      <stop offset="100%" stop-color="${frame.stops[2]}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <rect width="${CANVAS}" height="${CANVAS}" fill="url(#vignette)"/>
  ${elementLine(frame.width, el)}
  ${frameSvg(frame)}
  ${s.scars > 0 ? scarsSvg(Math.min(s.scars, SCAR_SPOTS.length)) : ""}

  <g filter="url(#shadow)">
    ${levelBadge(s.level, s.element % 4)}
    ${namePlate(label, signature, signatureDark)}
    ${s.weaponTier > 0 ? gearTile(70, 830, s.weaponTier, "weapon") : ""}
    ${s.armorTier > 0 ? gearTile(830, 830, s.armorTier, "armor") : ""}
    ${title ? ribbon(title, signature, signatureDark) : ""}
    ${s.injured ? injuredTag() : ""}
  </g>
</svg>`;
}

/** The element shows as a glowing line just inside the frame. */
function elementLine(frameWidth: number, el: (typeof ELEMENT_COLORS)[number]): string {
  const o = frameWidth + 10;
  const rect = `x="${o}" y="${o}" width="${CANVAS - 2 * o}" height="${CANVAS - 2 * o}" rx="24" fill="none"`;
  return `<rect ${rect} stroke="${el.main}" stroke-width="16" stroke-opacity="0.9" filter="url(#elementGlow)"/>
  <rect ${rect} stroke="${el.glow}" stroke-width="4"/>`;
}

function frameSvg(f: FrameTier): string {
  const w = f.width;
  const inset = w / 2;
  const parts = [
    `<rect x="${inset}" y="${inset}" width="${CANVAS - w}" height="${CANVAS - w}" rx="36" fill="none" stroke="url(#frame)" stroke-width="${w}"/>`,
    `<rect x="${w + 4}" y="${w + 4}" width="${CANVAS - 2 * w - 8}" height="${CANVAS - 2 * w - 8}" rx="26" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="3"/>`,
  ];
  if (f.studs) {
    for (const t of [0.25, 0.5, 0.75]) {
      for (const [x, y] of [
        [CANVAS * t, inset],
        [CANVAS * t, CANVAS - inset],
        [inset, CANVAS * t],
        [CANVAS - inset, CANVAS * t],
      ]) {
        parts.push(`<circle cx="${x}" cy="${y}" r="${w * 0.32}" fill="${f.stops[1]}" stroke="#000" stroke-opacity="0.4" stroke-width="2"/>`);
      }
    }
  }
  if (f.ornaments) {
    for (const [x, y] of [
      [inset + 20, inset + 20],
      [CANVAS - inset - 20, inset + 20],
      [inset + 20, CANVAS - inset - 20],
      [CANVAS - inset - 20, CANVAS - inset - 20],
    ]) {
      parts.push(star(x!, y!, 30, 13, f.stops[1], "#000"));
    }
  }
  return parts.join("\n  ");
}

function levelBadge(level: number, element: number): string {
  const el = ELEMENT_COLORS[element]!;
  return `<g transform="translate(118 118)">
      <circle r="78" fill="#1b1430" stroke="${el.main}" stroke-width="8"/>
      <circle r="66" fill="none" stroke="${el.glow}" stroke-opacity="0.5" stroke-width="2"/>
      <text y="-14" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="24" fill="${el.glow}" letter-spacing="2">LV</text>
      <text y="38" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="${level >= 10 ? 50 : 58}" fill="#ffffff">${level}</text>
      <g transform="translate(52 52)">
        <circle r="24" fill="${el.main}" stroke="#1b1430" stroke-width="4"/>
        ${elementGlyph(element)}
      </g>
    </g>`;
}

function elementGlyph(i: number): string {
  switch (i) {
    case 0: // Ember: flame
      return `<path d="M0 -14 C8 -4 10 4 6 10 C3 14 -3 14 -6 10 C-10 4 -6 -2 -2 -4 C-2 2 2 2 2 -2 C2 -6 0 -10 0 -14Z" fill="#fff"/>`;
    case 1: // Moss: leaf
      return `<path d="M-10 10 C-10 -6 2 -14 12 -12 C12 0 4 12 -10 10Z M-10 10 L4 -4" fill="#fff" stroke="#fff" stroke-width="2"/>`;
    case 2: // Volt: bolt
      return `<path d="M3 -15 L-8 2 L-1 2 L-4 15 L8 -3 L1 -3Z" fill="#1b1430"/>`;
    default: // Tide: drop
      return `<path d="M0 -14 C6 -4 10 2 10 6 C10 12 5 15 0 15 C-5 15 -10 12 -10 6 C-10 2 -6 -4 0 -14Z" fill="#fff"/>`;
  }
}

function namePlate(label: string, color: string, dark: string): string {
  const width = Math.max(220, 26 + label.length * 21);
  const x = CANVAS - 56 - width;
  return `<g transform="translate(${x} 60)">
      <rect width="${width}" height="70" rx="35" fill="${dark}" stroke="${color}" stroke-width="5"/>
      <text x="${width / 2}" y="46" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="32" fill="#ffffff">${escapeXml(label)}</text>
    </g>`;
}

const TIER_COLORS = ["", "#b0763c", "#a9b4c2", "#ff4fd8"] as const;

function gearTile(x: number, y: number, tier: number, slot: "weapon" | "armor"): string {
  const c = TIER_COLORS[Math.min(tier, 3)]!;
  const icon =
    slot === "weapon"
      ? `<path d="M-30 30 L18 -18 M10 -28 L28 -10 M14 -24 L24 -14" stroke="${c}" stroke-width="12" stroke-linecap="round" fill="none"/>
         <circle cx="-30" cy="30" r="8" fill="${c}"/>`
      : `<path d="M0 -34 L30 -22 L28 6 C26 22 14 32 0 38 C-14 32 -26 22 -28 6 L-30 -22Z" fill="${c}" stroke="#1b1430" stroke-width="4"/>
         <path d="M0 -20 L0 26 M-16 0 L16 0" stroke="#1b1430" stroke-width="5" stroke-opacity="0.5"/>`;
  const pips = Array.from({ length: tier }, (_, i) => `<circle cx="${-18 + i * 18}" cy="58" r="6" fill="${c}"/>`).join("");
  return `<g transform="translate(${x + 62} ${y + 54})">
      <rect x="-62" y="-62" width="124" height="138" rx="24" fill="#1b1430" stroke="${c}" stroke-width="6"/>
      ${icon}
      ${pips}
    </g>`;
}

function ribbon(title: string, color: string, dark: string): string {
  const text = title.toUpperCase();
  const width = Math.max(300, 60 + text.length * 26);
  const x = (CANVAS - width) / 2;
  return `<g transform="translate(${x} 896)">
      <path d="M-34 10 L0 10 L0 66 L-34 66 L-18 38Z" fill="${dark}"/>
      <path d="M${width + 34} 10 L${width} 10 L${width} 66 L${width + 34} 66 L${width + 18} 38Z" fill="${dark}"/>
      <rect width="${width}" height="76" rx="12" fill="${color}" stroke="#1b1430" stroke-width="5"/>
      <text x="${width / 2}" y="51" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="36" fill="#1b1430" letter-spacing="3">${escapeXml(text)}</text>
    </g>`;
}

function injuredTag(): string {
  return `<g transform="translate(72 236) rotate(-8)">
      <rect width="190" height="54" rx="12" fill="#e5383b" stroke="#fff" stroke-width="4"/>
      <path d="M26 27 h22 M37 16 v22" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
      <text x="112" y="37" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="24" fill="#fff">INJURED</text>
    </g>`;
}

function scarsSvg(n: number): string {
  return SCAR_SPOTS.slice(0, n)
    .map((s) => {
      const inner =
        s.kind === "plaster"
          ? `<g><rect x="-40" y="-13" width="80" height="26" rx="10" fill="#f3c9a1" stroke="#7a4a2a" stroke-width="3"/>
               <rect x="-13" y="-40" width="26" height="80" rx="10" fill="#f3c9a1" stroke="#7a4a2a" stroke-width="3"/>
               <circle cx="-5" cy="-5" r="2.5" fill="#7a4a2a"/><circle cx="5" cy="5" r="2.5" fill="#7a4a2a"/></g>`
          : s.kind === "stitch"
            ? `<g stroke-linecap="round"><g stroke="#fff" stroke-width="10" stroke-opacity="0.8"><path d="M-34 0 L34 0"/><path d="M-22 -12 L-22 12 M-4 -12 L-4 12 M14 -12 L14 12"/></g>
               <g stroke="#4a1018" stroke-width="5"><path d="M-34 0 L34 0"/><path d="M-22 -12 L-22 12 M-4 -12 L-4 12 M14 -12 L14 12"/></g></g>`
            : `<g stroke-linecap="round"><g stroke="#fff" stroke-width="12" stroke-opacity="0.8"><path d="M-30 -8 L30 8"/><path d="M-22 10 L22 22"/></g>
               <g stroke="#9b1426" stroke-width="7"><path d="M-30 -8 L30 8"/><path d="M-22 10 L22 22"/></g></g>`;
      return `<g transform="translate(${s.x} ${s.y}) rotate(${s.r}) scale(1.45)">${inner}</g>`;
    })
    .join("\n  ");
}

function star(cx: number, cy: number, outer: number, inner: number, fill: string, stroke: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-opacity="0.45" stroke-width="2"/>`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
