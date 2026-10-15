import { ELEMENT_COLORS, escapeXml, headlineTitle, type ArtState } from "./art.js";

/** Social preview size (Open Graph and X large cards). */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** Where the evolved portrait sits on the card. */
export const CARD_PORTRAIT = { x: 48, y: 48, size: 534 } as const;

export interface CardState {
  art: ArtState;
  rep: number;
  wins: number;
  losses: number;
  quests: number;
  /** Lifetime CHOG earned, already formatted for display (e.g. "94.81"). */
  earned: string;
  /** Domain shown in the footer, e.g. "chog-world-zeta.vercel.app". */
  site: string;
}

const INK = "#0d0a18";
const NIGHT = "#1b1430";
const NIGHT_2 = "#251c40";
const PAPER = "#fbf6ff";
const MUTED = "#b6a8d6";
const GOLD = "#ffd23f";
const FONT = "Arial Black, Arial, Helvetica, sans-serif";
const BODY = "Arial, Helvetica, sans-serif";

/** Width of the text column to the right of the portrait. */
const TEXT_WIDTH = CARD_WIDTH - (CARD_PORTRAIT.x + CARD_PORTRAIT.size + 56) - 40;

/**
 * Font size that fits a name on one line in the text column. Bold Arial runs about 0.62em per
 * character; the SVG renderer ignores textLength, so the size itself has to do the fitting.
 */
function nameSize(name: string): number {
  return Math.min(72, Math.floor(TEXT_WIDTH / (name.length * 0.62)));
}

/** CHOG with at most 2 decimals and thousands separators: "1,234.5". */
export function chogAmount(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const cents = Number((wei % 10n ** 18n) / 10n ** 16n);
  const frac = cents === 0 ? "" : `.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
  return `${whole.toLocaleString("en-US")}${frac}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Background and text for a Chog's share card, as SVG. The portrait is composited separately into
 * CARD_PORTRAIT, so this layer leaves that square empty (with its sticker shadow and border).
 */
export function renderCardSvg(c: CardState): string {
  const { art } = c;
  const el = ELEMENT_COLORS[art.element % 4]!;
  const hueGlow = `hsl(${art.hue} 85% 55%)`;
  const name = truncate(art.nickname ?? `Chog #${art.tokenId}`, 28);
  const title = headlineTitle(art.titles);
  const p = CARD_PORTRAIT;
  const x = p.x + p.size + 56;
  const stats: [string, string][] = [
    ["REP", String(c.rep)],
    ["WINS", String(c.wins)],
    ["LOSSES", String(c.losses)],
    ["QUESTS", String(c.quests)],
  ];
  const boxW = 120;
  const gap = 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="22%" cy="45%" r="70%">
      <stop offset="0%" stop-color="${hueGlow}" stop-opacity="0.45"/>
      <stop offset="60%" stop-color="${NIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${NIGHT}"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>

  <rect x="${p.x + 10}" y="${p.y + 10}" width="${p.size}" height="${p.size}" rx="28" fill="${INK}"/>
  <rect x="${p.x - 4}" y="${p.y - 4}" width="${p.size + 8}" height="${p.size + 8}" rx="30" fill="${INK}"/>

  <text x="${x}" y="92" font-family="${FONT}" font-weight="900" font-size="26" fill="${PAPER}" letter-spacing="2">CHOG <tspan fill="${GOLD}">WORLD</tspan></text>

  <text x="${x}" y="190" font-family="${FONT}" font-weight="900" font-size="${nameSize(name)}" fill="${PAPER}">${escapeXml(name)}</text>

  <g transform="translate(${x} 222)">
    <rect width="150" height="46" rx="23" fill="${GOLD}" stroke="${INK}" stroke-width="3"/>
    <text x="75" y="32" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="24" fill="${INK}">LEVEL ${art.level}</text>
    <rect x="164" width="${el.name.length * 15 + 120}" height="46" rx="23" fill="${el.main}" stroke="${INK}" stroke-width="3"/>
    <text x="${164 + (el.name.length * 15 + 120) / 2}" y="31" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="21" fill="${INK}">${escapeXml(el.name)} element</text>
  </g>

  ${
    title
      ? `<text x="${x}" y="318" font-family="${BODY}" font-weight="700" font-size="24" fill="${GOLD}">★ ${escapeXml(title)}</text>`
      : `<text x="${x}" y="318" font-family="${BODY}" font-size="22" fill="${MUTED}">No titles yet. Give it time.</text>`
  }

  ${stats
    .map(
      ([label, value], i) => `<g transform="translate(${x + i * (boxW + gap)} 350)">
    <rect width="${boxW}" height="92" rx="18" fill="${NIGHT_2}" stroke="${INK}" stroke-width="3"/>
    <text x="${boxW / 2}" y="30" text-anchor="middle" font-family="${BODY}" font-weight="700" font-size="15" fill="${MUTED}" letter-spacing="1.5">${label}</text>
    <text x="${boxW / 2}" y="72" text-anchor="middle" font-family="${FONT}" font-weight="900" font-size="34" fill="${PAPER}">${escapeXml(value)}</text>
  </g>`,
    )
    .join("\n  ")}

  <text x="${x}" y="488" font-family="${BODY}" font-size="22" fill="${MUTED}">Earned <tspan fill="${PAPER}" font-weight="700">${escapeXml(c.earned)} CHOG</tspan> on its own</text>

  <text x="${x}" y="548" font-family="${BODY}" font-size="19" fill="${MUTED}">Every Chog was born identical.</text>
  <text x="${x}" y="576" font-family="${BODY}" font-weight="700" font-size="19" fill="${PAPER}">This one became someone · ${escapeXml(c.site)}</text>
</svg>`;
}
