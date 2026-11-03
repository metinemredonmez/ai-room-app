/**
 * AI Room design tokens (docs/API.md §6). Every screen reads colours through `useTheme()`.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    primary: '#1F6F5C',
    primarySoft: '#E3F0EB',
    accent: '#E07A4F',
    accentSoft: '#FBE9E0',
    background: '#F7F4EF',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEAE2',
    text: '#141414',
    textSecondary: '#6B6A66',
    border: '#E6E1D8',
    danger: '#C2410C',
    success: '#15803D',
    onPrimary: '#FFFFFF',
    overlay: 'rgba(20,20,20,0.55)',
  },
  dark: {
    primary: '#3FB28F',
    primarySoft: '#16342B',
    accent: '#F09A72',
    accentSoft: '#3A2419',
    background: '#0E1311',
    surface: '#18201D',
    surfaceAlt: '#212B27',
    text: '#F2EFEA',
    textSecondary: '#A3A8A4',
    border: '#2A332F',
    danger: '#FB923C',
    success: '#4ADE80',
    onPrimary: '#0E1311',
    overlay: 'rgba(0,0,0,0.65)',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof ThemeColors;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 820;
