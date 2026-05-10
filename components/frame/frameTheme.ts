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

export const getFontForLang = (lang: string | undefined, isName: boolean) => {
  const language = lang || 'en';
  const w800 = '800' as const;
  const w700 = '700' as const;
  switch (language) {
    case 'hi':
    case 'en':
      return { fontFamily: isName ? 'Poppins-ExtraBold' : 'Poppins-Bold', fontWeight: isName ? w800 : w700 };
    case 'pa':
      return {
        fontFamily: isName ? 'NotoSansGurmukhi-ExtraBold' : 'NotoSansGurmukhi-Bold',
        fontWeight: isName ? w800 : w700,
      };
    case 'gu':
      return {
        fontFamily: isName ? 'NotoSansGujarati-ExtraBold' : 'NotoSansGujarati-Bold',
        fontWeight: isName ? w800 : w700,
      };
    case 'mr':
      return { fontFamily: isName ? 'GoogleSans-Bold' : 'GoogleSans-SemiBold', fontWeight: w700 };
    default:
      return { fontFamily: isName ? 'Poppins-ExtraBold' : 'Poppins-Bold', fontWeight: isName ? w800 : w700 };
  }
};

export const FRAME_TEXT_BAND_MIN_HEIGHT = 55;
