/**
 * Profile-driven frame typography only.
 * Use `profiles.language` / `UserInfo.language` — never app UI locale, device locale, or i18n.
 */

export type FrameProfileLanguageCode = 'en' | 'hi' | 'mr' | 'pa' | 'gu';

export type FrameFonts = {
  /** Display name — strongest weight for hierarchy */
  nameFont: string;
  /** Designations, social strip values — lighter than name */
  infoFont: string;
};

/** Keys must match PostScript names in the TTF files (used as React Native `fontFamily`). */
export const FRAME_FONT_ASSETS = {
  'Poppins-ExtraBold': require('../assets/fonts/Poppins-ExtraBold.ttf'),
  'Poppins-Bold': require('../assets/fonts/Poppins-Bold.ttf'),
  'Khand-Bold': require('../assets/fonts/Khand-Bold.ttf'),
  'Khand-SemiBold': require('../assets/fonts/Khand-SemiBold.ttf'),
  'NotoSerifGurmukhi-ExtraBold': require('../assets/fonts/NotoSerifGurmukhi-ExtraBold.ttf'),
  'NotoSerifGurmukhi-Bold': require('../assets/fonts/NotoSerifGurmukhi-Bold.ttf'),
  'NotoSansGujarati-ExtraBold': require('../assets/fonts/NotoSansGujarati-ExtraBold.ttf'),
  'NotoSansGujarati-Bold': require('../assets/fonts/NotoSansGujarati-Bold.ttf'),
} as const;

export function normalizeProfileFrameLanguage(raw: string | undefined | null): FrameProfileLanguageCode {
  const code = String(raw ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if (code === 'hi' || code === 'mr' || code === 'pa' || code === 'gu') return code;
  return 'en';
}

/**
 * Typography for frame chrome only, keyed by profile language (`UserInfo.language`).
 * Text content is rendered as stored — no auto-detection or translation.
 */
export function getFrameFonts(language: string | undefined | null): FrameFonts {
  const lang = normalizeProfileFrameLanguage(language);
  switch (lang) {
    case 'hi':
    case 'mr':
      return { nameFont: 'Khand-Bold', infoFont: 'Khand-SemiBold' };
    case 'pa':
      return { nameFont: 'NotoSerifGurmukhi-ExtraBold', infoFont: 'NotoSerifGurmukhi-Bold' };
    case 'gu':
      return { nameFont: 'NotoSansGujarati-ExtraBold', infoFont: 'NotoSansGujarati-Bold' };
    case 'en':
    default:
      return { nameFont: 'Poppins-ExtraBold', infoFont: 'Poppins-Bold' };
  }
}
