import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { StyleCard, isPro, openPaywall } from '@/components/catalog-cards';
import { Screen } from '@/components/screen';
import { AppText, ErrorBanner, PaletteBar } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type InspirationItem } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function InspireScreen() {
  const c = useTheme();
  const { t, catalog, user, errorMessage } = useSession();
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pro = isPro(user);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await api.inspiration()).items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [errorMessage]);

  useEffect(() => {
    let cancelled = false;
    api
      .inspiration()
      .then((res) => !cancelled && setItems(res.items))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [errorMessage]);

  const styleName = (id: string) => catalog?.styles.find((s) => s.id === id)?.name ?? id;

  return (
    <Screen tab refreshing={loading} onRefresh={load}>
      <AppText variant="title">{t('inspire.title')}</AppText>
      <AppText muted style={{ marginBottom: Spacing.three }}>
        {t('inspire.subtitle')}
      </AppText>
      {error ? <ErrorBanner message={error} onRetry={load} retryLabel={t('common.retry')} /> : null}

      {items.length > 0 ? (
        <View style={styles.grid}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() =>
                router.push({ pathname: '/create', params: { tool: 'redesign', styleId: item.styleId, roomId: item.roomId } })
              }
              style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
              <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" transition={200} />
              <View style={styles.meta}>
                <AppText variant="smallBold" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {styleName(item.styleId)}
                </AppText>
                <PaletteBar colors={item.palette} height={5} radius={3} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.grid}>
          {catalog?.styles.map((style) => (
            <StyleCard
              key={style.id}
              style={style}
              width="48%"
              locked={style.isPro && !pro}
              onPress={() =>
                style.isPro && !pro
                  ? openPaywall()
                  : router.push({ pathname: '/create', params: { tool: 'redesign', styleId: style.id } })
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'space-between' },
  card: { width: '48%', borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 0.85 },
  meta: { padding: Spacing.two, gap: 4 },
});
