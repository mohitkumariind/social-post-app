export type PartySocialStripPalette = { bg: string; fg: string };

export function getFramePartyStripPalette(partyName: unknown): PartySocialStripPalette {
  const p = String(partyName ?? '').toLowerCase();
  if (p.includes('bjp')) return { bg: '#FF9933', fg: '#1E293B' };
  if (p.includes('congress')) return { bg: '#00A03E', fg: '#FFFFFF' };
  if (p.includes('aap') || p.includes('aam aadmi')) return { bg: '#003399', fg: '#FFFFFF' };
  if (p.includes('akali')) return { bg: '#FFCC00', fg: '#1E293B' };
  return { bg: '#1E293B', fg: '#FFFFFF' };
}

export type FrameSocialStripItem = { key: string; icon: string; value: string };

export function buildFrameSocialStripItems(
  u: { whatsapp?: string; facebook?: string; twitter?: string; instagram?: string } | null | undefined
): FrameSocialStripItem[] {
  if (!u) return [];
  const out: FrameSocialStripItem[] = [];
  const wa = String(u.whatsapp ?? '').trim();
  if (wa) out.push({ key: 'wa', icon: 'logo-whatsapp', value: wa });
  const fb = String(u.facebook ?? '').trim();
  if (fb) out.push({ key: 'fb', icon: 'logo-facebook', value: fb });
  const tw = String(u.twitter ?? '').trim();
  if (tw) out.push({ key: 'tw', icon: 'logo-twitter', value: tw });
  const ig = String(u.instagram ?? '').trim();
  if (ig) out.push({ key: 'ig', icon: 'logo-instagram', value: ig });
  return out;
}

export const FRAME_TEXT_BAND_MIN_HEIGHT = 55;
