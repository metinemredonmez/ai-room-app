import { Colors, type ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme(): ThemeColors & { scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...Colors[scheme], scheme };
}
