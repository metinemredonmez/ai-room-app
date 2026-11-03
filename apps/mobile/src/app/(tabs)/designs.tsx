import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText, Badge, Button, EmptyState, ErrorBanner, Segmented, confirmAsync } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Design } from '@/lib/api';
import { formatDate } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Filter = 'all' | 'favorites';

export default function DesignsScreen() {
  const c = useTheme();
  const { t, locale, errorMessage } = useSession();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Design[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (reset: boolean, nextCursor: string | null = null) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const page = await api.designs({ cursor: reset ? null : nextCursor, favorite: filter === 'favorites' });
        if (id !== requestId.current) return;
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
      } catch (e) {
        if (id === requestId.current) setError(errorMessage(e));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [filter, errorMessage],
  );

  useFocusEffect(
    useCallback(() => {
      load(true);
    }, [load]),
  );

  const toggleFavorite = async (design: Design) => {
    try {
      const updated = await api.setFavorite(design.id, !design.favorite);
      setItems((prev) =>
        filter === 'favorites' && !updated.favorite
          ? prev.filter((d) => d.id !== design.id)
          : prev.map((d) => (d.id === design.id ? updated : d)),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (design: Design) => {
    if (!(await confirmAsync(t('designs.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    try {
      await api.deleteDesign(design.id);
      setItems((prev) => prev.filter((d) => d.id !== design.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen tab refreshing={loading && items.length > 0} onRefresh={() => load(true)}>
      <AppText variant="title" style={{ marginBottom: Spacing.three }}>
        {t('designs.title')}
      </AppText>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('designs.all') },
          { value: 'favorites', label: t('designs.favorites') },
        ]}
      />
      <View style={{ height: Spacing.three }} />
      {error ? <ErrorBanner message={error} onRetry={() => load(true)} retryLabel={t('common.retry')} /> : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          icon="images-outline"
          title={t('designs.empty')}
          text={t('designs.emptyHint')}
          action={
            <Button
              label={t('home.heroTitle')}
              icon="sparkles"
              onPress={() => router.push({ pathname: '/create', params: { tool: 'redesign' } })}
            />
          }
        />
      ) : null}

      <View style={styles.grid}>
        {items.map((design) => {
          const cover = design.results[0] ?? design.input;
          return (
            <Pressable
              key={design.id}
              accessibilityRole="button"
              accessibilityLabel={design.title}
              onPress={() => router.push({ pathname: '/design/[id]', params: { id: design.id } })}
              style={({ pressed }) => [styles.card, { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
              <View>
                <Image source={{ uri: cover.url }} style={styles.image} contentFit="cover" transition={150} />
                {design.status === 'FAILED' ? (
                  <View style={styles.status}>
                    <Badge label={t('designs.failed')} tone="accent" />
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('design.favorite')}
                    hitSlop={6}
                    onPress={() => toggleFavorite(design)}
                    style={styles.actionBtn}>
                    <Ionicons name={design.favorite ? 'heart' : 'heart-outline'} size={18} color={design.favorite ? '#F87171' : '#fff'} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    hitSlop={6}
                    onPress={() => remove(design)}
                    style={styles.actionBtn}>
                    <Ionicons name="trash-outline" size={17} color="#fff" />
                  </Pressable>
                </View>
              </View>
              <View style={styles.meta}>
                <AppText variant="smallBold" numberOfLines={1}>
                  {design.title}
                </AppText>
                <AppText variant="caption" muted>
                  {formatDate(design.createdAt, locale)}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {cursor ? (
        <Button
          label={t('common.loadMore')}
          kind="secondary"
          loading={loading}
          style={{ marginTop: Spacing.three }}
          onPress={() => load(false, cursor)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'space-between' },
  card: { width: '48%', borderRadius: Radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 1 },
  status: { position: 'absolute', left: 8, top: 8 },
  actions: { position: 'absolute', right: 6, top: 6, gap: 6 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { padding: Spacing.two, gap: 2 },
});
