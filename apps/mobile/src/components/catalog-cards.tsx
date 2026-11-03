import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, PaletteBar, PaletteGradient, iconOrFallback } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CatalogStyle, CatalogTool, User } from '@/lib/api';
import { useSession } from '@/lib/session';

export function isPro(user: User | null) {
  return user?.plan === 'PRO';
}

export function ToolCard({ tool, onPress }: { tool: CatalogTool; onPress: () => void }) {
  const c = useTheme();
  const { t } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tool.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={[styles.toolIcon, { backgroundColor: c.primarySoft }]}>
        <Ionicons name={iconOrFallback(tool.icon)} size={22} color={c.primary} />
      </View>
      <AppText variant="smallBold" numberOfLines={2} style={{ textAlign: 'center' }}>
        {tool.name}
      </AppText>
      {tool.isNew || tool.isPro ? (
        <View style={styles.toolBadge}>
          <Badge label={tool.isPro ? t('common.pro') : t('common.new')} tone={tool.isPro ? 'accent' : 'primary'} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function StyleCard({
  style,
  onPress,
  width = 150,
  locked,
}: {
  style: CatalogStyle;
  onPress: () => void;
  width?: number | `${number}%`;
  locked?: boolean;
}) {
  const c = useTheme();
  const { t } = useSession();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={style.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.style,
        { width, backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}>
      <PaletteGradient colors={style.palette} style={styles.styleArt}>
        <Ionicons name="color-palette-outline" size={26} color="rgba(255,255,255,0.9)" />
        {style.isPro ? (
          <View style={styles.styleBadge}>
            <Badge label={locked ? `🔒 ${t('common.pro')}` : t('common.pro')} tone="dark" />
          </View>
        ) : null}
      </PaletteGradient>
      <View style={{ padding: Spacing.two, gap: 6 }}>
        <AppText variant="smallBold" numberOfLines={1}>
          {style.name}
        </AppText>
        <PaletteBar colors={style.palette} height={6} radius={3} />
      </View>
    </Pressable>
  );
}

export function openPaywall() {
  router.push('/paywall');
}

const styles = StyleSheet.create({
  tool: {
    width: '31.5%',
    minWidth: 96,
    flexGrow: 1,
    maxWidth: 170,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  toolBadge: { position: 'absolute', top: 6, right: 6 },
  style: { borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  styleArt: { height: 104, alignItems: 'center', justifyContent: 'center' },
  styleBadge: { position: 'absolute', top: 8, left: 8 },
});
