/**
 * App theme - Instagram-style clean & modern
 * Background: Pure White
 * Primary: Green (buttons, active tabs, progress bars)
 * Secondary: Purple (save button, etc.)
 * Text on colored bg: White
 * Cards: Shadow (elevation), no borders
 */

export const Colors = {
  primary: '#43A047', // Green - Accent (buttons, active tabs, progress)
  secondary: '#8E24AA', // Purple
  accent: '#43A047',

  text: '#262626', // Headers, primary text
  textMuted: '#8E8E8E',
  background: '#FFFFFF',

  // Cards: white with shadow (Insta-style)
  cardBg: '#FFFFFF',
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardElevation: 2,

  border: '#EFEFEF',
  borderLight: '#FAFAFA',
  white: '#FFFFFF',
  textOnPrimary: '#FFFFFF', // Text on colored buttons/headers
  error: '#DC2626',
  successBg: '#E8F5E9',

  /** Instagram-style: 8-10px radius */
  borderRadius: 10,
  borderRadiusSm: 8,
  spacing: 20,

  /** Typography - Inter, headers bold #262626 */
  fontFamily: 'Inter_400Regular',
  fontFamilyBold: 'Inter_700Bold',
  headerColor: '#262626',
};
