import { Platform } from 'react-native';

export type ThemeId = 'emerald' | 'obsidian' | 'nordic' | 'crimson' | 'oled' | 'solar' | 'custom';
export type DarkBase = 'obsidian' | 'oled' | 'midnight' | 'charcoal';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  previewColor: string;     // Primary Accent
  secondaryAccent: string;  // Secondary Accent
  previewBg: string;        // Surface preview
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceHi: string;
  surfaceHighlight: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  dim: string;
  dimmer: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  blue: string;
  blueSoft: string;
  kcal: string;
  protein: string;
  proteinSoft: string;
  carbs: string;
  carbsSoft: string;
  fat: string;
  fatSoft: string;
  weight: string;
  weightSoft: string;
  danger: string;
  dangerSoft: string;
  warn: string;
  onAccent: string;
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function createCustomTheme(
  primaryHex: string,
  base: DarkBase = 'obsidian',
  secondaryHex?: string
): ThemeDefinition {
  const [r, g, b] = hexToRgb(primaryHex);
  const isLight = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  const onAccent = isLight ? '#080B10' : '#FFFFFF';
  const sec = secondaryHex || hslToHex((Math.round(parseInt(primaryHex.replace('#', ''), 16) % 360) + 45) % 360, 85, 60);

  const bases: Record<DarkBase, { bg: string; surface: string; surfaceAlt: string; surfaceHi: string; border: string; borderLight: string }> = {
    oled: {
      bg: '#000000',
      surface: '#0E0E12',
      surfaceAlt: '#16161D',
      surfaceHi: '#20202A',
      border: '#1F1F28',
      borderLight: '#2D2D3A',
    },
    obsidian: {
      bg: '#080B10',
      surface: '#111622',
      surfaceAlt: '#171E2D',
      surfaceHi: '#1F293D',
      border: '#1E2738',
      borderLight: '#2A364F',
    },
    midnight: {
      bg: '#060A14',
      surface: '#0D1424',
      surfaceAlt: '#131D33',
      surfaceHi: '#1B2742',
      border: '#1B2742',
      borderLight: '#28385C',
    },
    charcoal: {
      bg: '#0E1015',
      surface: '#161920',
      surfaceAlt: '#1E222C',
      surfaceHi: '#272C38',
      border: '#252936',
      borderLight: '#343A4A',
    },
  };

  const bConf = bases[base] || bases.obsidian;

  return {
    id: 'custom',
    name: 'Custom Theme',
    tagline: 'Personalized Palette',
    previewColor: primaryHex,
    secondaryAccent: sec,
    previewBg: bConf.surface,
    bg: bConf.bg,
    surface: bConf.surface,
    surfaceAlt: bConf.surfaceAlt,
    surfaceHi: bConf.surfaceHi,
    surfaceHighlight: bConf.borderLight,
    border: bConf.border,
    borderLight: bConf.borderLight,
    text: '#F8FAFC',
    textSecondary: '#CBD5E1',
    dim: '#94A3B8',
    dimmer: '#64748B',
    accent: primaryHex,
    accentSoft: `rgba(${r},${g},${b},0.16)`,
    accentGlow: `rgba(${r},${g},${b},0.32)`,
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: primaryHex,
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#2DD4BF',
    fatSoft: 'rgba(45,212,191,0.15)',
    weight: '#A855F7',
    weightSoft: 'rgba(168,85,247,0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239,68,68,0.15)',
    warn: '#F59E0B',
    onAccent,
  };
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  emerald: {
    id: 'emerald',
    name: 'Emerald Slate',
    tagline: 'Signature Dark (Default)',
    previewColor: '#10B981',
    secondaryAccent: '#38BDF8',
    previewBg: '#111622',
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
    accent: '#10B981',
    accentSoft: 'rgba(16,185,129,0.15)',
    accentGlow: 'rgba(16,185,129,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#38BDF8',
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#2DD4BF',
    fatSoft: 'rgba(45,212,191,0.15)',
    weight: '#A855F7',
    weightSoft: 'rgba(168,85,247,0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239,68,68,0.15)',
    warn: '#F59E0B',
    onAccent: '#080B10',
  },
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian Purple',
    tagline: 'Deep Amethyst',
    previewColor: '#A855F7',
    secondaryAccent: '#38BDF8',
    previewBg: '#161E2E',
    bg: '#0B0F19',
    surface: '#161E2E',
    surfaceAlt: '#1E273B',
    surfaceHi: '#26334D',
    surfaceHighlight: '#324263',
    border: '#222F46',
    borderLight: '#2E3E5B',
    text: '#F8FAFC',
    textSecondary: '#CBD5E1',
    dim: '#94A3B8',
    dimmer: '#64748B',
    accent: '#A855F7',
    accentSoft: 'rgba(168,85,247,0.15)',
    accentGlow: 'rgba(168,85,247,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#38BDF8',
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#2DD4BF',
    fatSoft: 'rgba(45,212,191,0.15)',
    weight: '#A855F7',
    weightSoft: 'rgba(168,85,247,0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239,68,68,0.15)',
    warn: '#F59E0B',
    onAccent: '#0B0F19',
  },
  nordic: {
    id: 'nordic',
    name: 'Nordic Cyan',
    tagline: 'Glacial Electric Blue',
    previewColor: '#06B6D4',
    secondaryAccent: '#38BDF8',
    previewBg: '#10202E',
    bg: '#081018',
    surface: '#10202E',
    surfaceAlt: '#162B3D',
    surfaceHi: '#1E374D',
    surfaceHighlight: '#284763',
    border: '#1A3247',
    borderLight: '#254460',
    text: '#F0FDFA',
    textSecondary: '#CCFBF1',
    dim: '#5EEAD4',
    dimmer: '#2DD4BF',
    accent: '#06B6D4',
    accentSoft: 'rgba(6,182,212,0.15)',
    accentGlow: 'rgba(6,182,212,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#38BDF8',
    protein: '#FB7185',
    proteinSoft: 'rgba(251,113,133,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#2DD4BF',
    fatSoft: 'rgba(45,212,191,0.15)',
    weight: '#818CF8',
    weightSoft: 'rgba(129,140,248,0.15)',
    danger: '#F43F5E',
    dangerSoft: 'rgba(244,63,94,0.15)',
    warn: '#F59E0B',
    onAccent: '#081018',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Steel',
    tagline: 'Fiery Ruby Stealth',
    previewColor: '#EF4444',
    secondaryAccent: '#F59E0B',
    previewBg: '#241419',
    bg: '#140A0D',
    surface: '#241419',
    surfaceAlt: '#301A21',
    surfaceHi: '#3F232B',
    surfaceHighlight: '#522E38',
    border: '#381F26',
    borderLight: '#4C2A34',
    text: '#FEF2F2',
    textSecondary: '#FEE2E2',
    dim: '#FCA5A5',
    dimmer: '#F87171',
    accent: '#EF4444',
    accentSoft: 'rgba(239,68,68,0.15)',
    accentGlow: 'rgba(239,68,68,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#F87171',
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#34D399',
    fatSoft: 'rgba(52,211,153,0.15)',
    weight: '#C084FC',
    weightSoft: 'rgba(192,132,252,0.15)',
    danger: '#DC2626',
    dangerSoft: 'rgba(220,38,38,0.15)',
    warn: '#F59E0B',
    onAccent: '#140A0D',
  },
  oled: {
    id: 'oled',
    name: 'OLED Monolith',
    tagline: 'True 0% Pitch Black',
    previewColor: '#38BDF8',
    secondaryAccent: '#22C55E',
    previewBg: '#111115',
    bg: '#000000',
    surface: '#111115',
    surfaceAlt: '#1A1A20',
    surfaceHi: '#25252D',
    surfaceHighlight: '#32323D',
    border: '#22222A',
    borderLight: '#30303B',
    text: '#FFFFFF',
    textSecondary: '#E2E8F0',
    dim: '#94A3B8',
    dimmer: '#64748B',
    accent: '#38BDF8',
    accentSoft: 'rgba(56,189,248,0.15)',
    accentGlow: 'rgba(56,189,248,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#38BDF8',
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#2DD4BF',
    fatSoft: 'rgba(45,212,191,0.15)',
    weight: '#A855F7',
    weightSoft: 'rgba(168,85,247,0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239,68,68,0.15)',
    warn: '#F59E0B',
    onAccent: '#000000',
  },
  solar: {
    id: 'solar',
    name: 'Solar Amber',
    tagline: 'Warm Gold & Carbon',
    previewColor: '#F59E0B',
    secondaryAccent: '#F43F5E',
    previewBg: '#1A202C',
    bg: '#0E1117',
    surface: '#1A202C',
    surfaceAlt: '#232B3B',
    surfaceHi: '#2F3A4F',
    surfaceHighlight: '#3D4A63',
    border: '#283244',
    borderLight: '#36445D',
    text: '#FFFBEB',
    textSecondary: '#FEF3C7',
    dim: '#FDE68A',
    dimmer: '#FCD34D',
    accent: '#F59E0B',
    accentSoft: 'rgba(245,158,11,0.15)',
    accentGlow: 'rgba(245,158,11,0.3)',
    blue: '#38BDF8',
    blueSoft: 'rgba(56,189,248,0.15)',
    kcal: '#F59E0B',
    protein: '#F43F5E',
    proteinSoft: 'rgba(244,63,94,0.15)',
    carbs: '#FBBF24',
    carbsSoft: 'rgba(251,191,36,0.15)',
    fat: '#10B981',
    fatSoft: 'rgba(16,185,129,0.15)',
    weight: '#A855F7',
    weightSoft: 'rgba(168,85,247,0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239,68,68,0.15)',
    warn: '#F59E0B',
    onAccent: '#0E1117',
  },
  custom: createCustomTheme('#8B5CF6', 'obsidian', '#38BDF8'),
};

export const THEME_OPTIONS = Object.values(THEMES);

function normalizeThemeId(raw: string | null): ThemeId {
  if (!raw) return 'emerald';
  if (raw in THEMES) return raw as ThemeId;
  if (raw === 'verdant') return 'emerald';
  if (raw === 'cyan') return 'nordic';
  if (raw === 'amethyst') return 'obsidian';
  if (raw === 'gold') return 'solar';
  return 'emerald';
}

function loadSavedCustomTheme(): void {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const savedConfig = localStorage.getItem('custom_theme_config');
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        THEMES.custom = createCustomTheme(parsed.accent || '#8B5CF6', parsed.base || 'obsidian', parsed.secondary);
      }
    } catch {}
  }
}

loadSavedCustomTheme();

function getInitialThemeId(): ThemeId {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem('app_theme');
      return normalizeThemeId(saved);
    } catch {}
  }
  return 'emerald';
}

const currentInitialId = getInitialThemeId();

export const C: ThemeDefinition = {
  ...THEMES[currentInitialId],
};

export function applyTheme(rawId: string, customConfig?: { accent: string; base: DarkBase; secondary?: string }): void {
  const id = normalizeThemeId(rawId);
  if (id === 'custom' && customConfig) {
    THEMES.custom = createCustomTheme(customConfig.accent, customConfig.base, customConfig.secondary);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('custom_theme_config', JSON.stringify(customConfig));
      } catch {}
    }
  }

  if (THEMES[id]) {
    Object.assign(C, THEMES[id]);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('app_theme', id);
      } catch {}
    }
  }
}

export function getActiveThemeId(): ThemeId {
  return C.id;
}

export const Spacing = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 28 } as const;
export const Radius = 20;

export const FontStack = Platform.select({
  ios: 'system-ui',
  default: 'normal',
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
});
