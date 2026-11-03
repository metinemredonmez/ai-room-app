import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StyleCard, ToolCard, isPro, openPaywall } from '@/components/catalog-cards';
import { Screen } from '@/components/screen';
import { AppText, Button, Chip, SectionHeader, iconOrFallback } from '@/components/ui';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CatalogTool } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function HomeScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { catalog, user, t, refreshUser } = useSession();
  const pro = isPro(user);
  const remaining = (user?.dailyFreeRemaining ?? 0) + (user?.credits ?? 0);

  const openTool = (tool: CatalogTool) => {
    if (tool.isPro && !pro) return openPaywall();
    router.push({ pathname: '/create', params: { tool: tool.id } });
  };

  return (
    <Screen
      tab
      onRefresh={refreshUser}
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.chatFab')}
          onPress={() => router.push('/chat')}
          style={({ pressed }) => [
            styles.fab,
            { bottom: BottomTabInset + insets.bottom + Spacing.three, opacity: pressed ? 0.85 : 1 },
          ]}>
          <LinearGradient colors={[c.primary, c.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
            <Ionicons name="chatbubbles" size={24} color="#fff" />
          </LinearGradient>
        </Pressable>
      }>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <AppText variant="title">{t('app.name')}</AppText>
          <AppText variant="small" muted>
            {t('app.tagline')}
          </AppText>
        </View>
        <View style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Ionicons name="flash" size={14} color={c.accent} />
          <AppText variant="smallBold">
            {pro ? '∞' : remaining} {t('home.credits')}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={openPaywall}
          style={({ pressed }) => [styles.proButton, { backgroundColor: c.accent, opacity: pressed ? 0.85 : 1 }]}>
          <Ionicons name="diamond" size={14} color="#fff" />
          <AppText variant="smallBold" color="#fff">
            {t('common.pro')}
          </AppText>
        </Pressable>
      </View>

      <LinearGradient colors={[c.primary, '#2E8A72', c.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroArt}>
          <Ionicons name="bed-outline" size={34} color="rgba(255,255,255,0.35)" />
          <Ionicons name="sparkles" size={52} color="rgba(255,255,255,0.9)" />
          <Ionicons name="leaf-outline" size={30} color="rgba(255,255,255,0.35)" />
        </View>
        <AppText variant="title" color="#fff">
          {t('home.heroTitle')}
        </AppText>
        <AppText color="rgba(255,255,255,0.9)">{t('home.heroText')}</AppText>
        <Button
          label={t('home.heroCta')}
          icon="camera"
          kind="light"
          style={{ alignSelf: 'flex-start', marginTop: Spacing.two }}
          onPress={() => router.push({ pathname: '/create', params: { tool: 'redesign' } })}
        />
      </LinearGradient>

      <SectionHeader title={t('home.tools')} />
      <View style={styles.grid}>
        {catalog?.tools.map((tool) => <ToolCard key={tool.id} tool={tool} onPress={() => openTool(tool)} />)}
      </View>

      <SectionHeader title={t('home.rooms')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {catalog?.rooms.map((room) => (
          <Chip
            key={room.id}
            label={room.name}
            icon={iconOrFallback(room.icon, 'home-outline')}
            onPress={() => router.push({ pathname: '/create', params: { tool: 'redesign', roomId: room.id } })}
          />
        ))}
      </ScrollView>

      <SectionHeader title={t('home.styles')} action={t('common.seeAll')} onAction={() => router.push('/inspire')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {catalog?.styles.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            locked={style.isPro && !pro}
            onPress={() =>
              style.isPro && !pro
                ? openPaywall()
                : router.push({ pathname: '/create', params: { tool: 'redesign', styleId: style.id } })
            }
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  proButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  hero: { borderRadius: 24, padding: Spacing.four, gap: Spacing.two, overflow: 'hidden' },
  heroArt: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three, marginBottom: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  fab: { position: 'absolute', right: Spacing.three },
  fabInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
