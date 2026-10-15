import type { Metadata } from "next";
import { Title, TITLE_LABELS } from "@chog-world/shared";
import { API_URL } from "@/lib/config";

interface ChogSummary {
  profile: { nickname: string | null } | null;
  character: { level: number; wins: number; losses: number; titles: number };
}

/** Rarest title first, matching the ribbon on the Chog's picture. */
const TITLE_ORDER = [Title.UNBROKEN, Title.GIANT_SLAYER, Title.VETERAN, Title.EXPLORER, Title.DEVOTED, Title.FIRST_BLOOD];

async function summary(id: string): Promise<ChogSummary | null> {
  try {
    const res = await fetch(`${API_URL}/chogs/${id}`, { next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as ChogSummary) : null;
  } catch {
    return null;
  }
}

/**
 * Link previews for a Chog: its own share card instead of the site default, so a shared link shows
 * the evolved Chog, its level and its best title.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!/^\d{1,4}$/.test(id)) return {};
  const c = await summary(id);
  const name = c?.profile?.nickname ?? `Chog #${id}`;
  const title = c ? TITLE_ORDER.map((t) => (c.character.titles & (1 << t) ? TITLE_LABELS[t]?.name : null)).find(Boolean) : null;
  const headline = c ? `${name} · Level ${c.character.level}${title ? ` · ${title}` : ""}` : name;
  const description = c
    ? `${c.character.wins}W ${c.character.losses}L. Every Chog was born identical. This one became someone in CHOG World.`
    : "Every Chog was born identical. Watch this one become someone in CHOG World.";
  const card = { url: `${API_URL}/chogs/${id}/card.png`, width: 1200, height: 630, alt: `${name} in CHOG World` };
  return {
    title: `${name} · CHOG World`,
    description,
    openGraph: { title: headline, description, images: [card], url: `/chog/${id}` },
    twitter: { card: "summary_large_image", title: headline, description, images: [card.url] },
  };
}

export default function ChogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
