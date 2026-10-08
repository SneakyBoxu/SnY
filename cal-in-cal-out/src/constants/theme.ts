import { Platform } from 'react-native';

export const C = {
  bg: '#080B10',
  surface: '#111622',
  surfaceAlt: '#171E2D',
  surfaceHi: '#1F293D',
  surfaceHighlight: '#28344D',
  border: '#1E2738',
  borderLight: '#2A364F',
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  dim: '#94A3B8',
  dimmer: '#64748B',
  accent: '#10B981', // MacroFactor emerald
  accentSoft: 'rgba(16,185,129,0.15)',
  accentGlow: 'rgba(16,185,129,0.3)',
  blue: '#38BDF8',
  blueSoft: 'rgba(56,189,248,0.15)',
  kcal: '#38BDF8',
  protein: '#F43F5E', // Vibrant coral/rose
  proteinSoft: 'rgba(244,63,94,0.15)',
  carbs: '#FBBF24', // Amber gold
  carbsSoft: 'rgba(251,191,36,0.15)',
  fat: '#2DD4BF', // Mint cyan/teal
  fatSoft: 'rgba(45,212,191,0.15)',
  weight: '#A855F7', // Signature MacroFactor purple
  weightSoft: 'rgba(168,85,247,0.15)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.15)',
  warn: '#F59E0B',
  onAccent: '#080B10',
} as const;

export const Spacing = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 28 } as const;
export const Radius = 20;

export const FontStack = Platform.select({
  ios: 'system-ui',
  default: 'normal',
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});
