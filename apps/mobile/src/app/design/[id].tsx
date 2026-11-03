import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { AnalysisView } from '@/components/analysis-view';
import { BeforeAfter } from '@/components/before-after';
import { openPaywall } from '@/components/catalog-cards';
import { Screen } from '@/components/screen';
import { AppText, Button, EmptyState, ErrorBanner, IconButton } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type Analysis, type Design } from '@/lib/api';
import { formatDate } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function DesignScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale, errorMessage } = useSession();
  const [design, setDesign] = useState<Design | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDesign(await api.design(id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, errorMessage]);

  useEffect(() => {
    let cancelled = false;
    api
      .design(id)
      .then((d) => !cancelled && setDesign(d))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id, errorMessage]);

  if (!design) {
    return (
      <Screen>
        {error ? (
          <ErrorBanner message={error} onRetry={load} retryLabel={t('common.retry')} />
        ) : (
          <ActivityIndicator color={c.primary} style={{ marginTop: Spacing.six }} />
        )}
      </Screen>
    );
  }

  const result = design.results[selected] ?? design.results[0];
  const analysis = result ? analyses[result.id] : undefined;

  const toggleFavorite = async () => {
    try {
      setDesign(await api.setFavorite(design.id, !design.favorite));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const share = async () => {
    if (!result) return;
    try {
      await Share.share({ message: `${t('design.shareText')} ${result.url}`, url: result.url });
    } catch {
      // user dismissed
    }
  };

  const analyze = async () => {
    if (!result) return;
    setAnalyzing(true);
    setError(null);
    try {
      const a = await api.analyze(design.id, result.id);
      setAnalyses((prev) => ({ ...prev, [result.id]: a }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'insufficient_credits') openPaywall();
      else setError(errorMessage(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const askChat = () => {
    const img = result ?? design.input;
    router.push({ pathname: '/chat', params: { imageId: img.id, imageUrl: img.url } });
  };

  const again = () =>
    router.push({
      pathname: '/create',
      params: {
        tool: design.tool,
        ...(design.styleId ? { styleId: design.styleId } : {}),
        ...(design.roomId ? { roomId: design.roomId } : {}),
        imageId: design.input.id,
        imageUrl: design.input.url,
        imageW: String(design.input.width),
        imageH: String(design.input.height),
      },
    });

  return (
    <Screen>
      <AppText variant="title">{design.title}</AppText>
      <AppText variant="small" muted style={{ marginBottom: Spacing.three }}>
        {formatDate(design.createdAt, locale)}
      </AppText>

      {error ? (
        <View style={{ marginBottom: Spacing.three }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      {design.status !== 'SUCCEEDED' || !result ? (
        <EmptyState
          icon="alert-circle-outline"
          title={t('design.failed')}
          text={design.error ?? undefined}
          action={<Button label={t('design.again')} icon="refresh" onPress={again} />}
        />
      ) : (
        <>
          <BeforeAfter
            beforeUri={design.input.url}
            afterUri={result.url}
            aspectRatio={design.input.width / Math.max(1, design.input.height)}
            beforeLabel={t('design.before')}
            afterLabel={t('design.after')}
          />

          {design.results.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variants}>
              {design.results.map((r, i) => (
                <Pressable
                  key={r.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('design.variant')} ${i + 1}`}
                  accessibilityState={{ selected: i === selected }}
                  onPress={() => setSelected(i)}
                  style={[styles.thumbWrap, { borderColor: i === selected ? c.primary : 'transparent' }]}>
                  <Image source={{ uri: r.url }} style={styles.thumb} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.actions}>
            <IconButton
              icon={design.favorite ? 'heart' : 'heart-outline'}
              color={design.favorite ? '#EF4444' : c.text}
              label={t('design.favorite')}
              onPress={toggleFavorite}
              size={46}
            />
            <IconButton icon="share-outline" label={t('design.share')} onPress={share} size={46} />
            <IconButton icon="chatbubbles-outline" label={t('design.askChat')} onPress={askChat} size={46} />
            <IconButton icon="refresh" label={t('design.again')} onPress={again} size={46} />
          </View>

          {analysis ? (
            <View style={{ marginTop: Spacing.four }}>
              <AnalysisView analysis={analysis} />
            </View>
          ) : (
            <View style={{ marginTop: Spacing.four, gap: Spacing.two }}>
              <Button label={t('design.analyze')} icon="bag-handle-outline" size="lg" loading={analyzing} onPress={analyze} />
              {analyzing ? (
                <AppText variant="small" muted style={{ textAlign: 'center' }}>
                  {t('analysis.loading')}
                </AppText>
              ) : null}
              <Button label={t('design.askChat')} icon="chatbubbles-outline" kind="secondary" onPress={askChat} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  variants: { gap: Spacing.two, paddingVertical: Spacing.three },
  thumbWrap: { borderWidth: 2, borderRadius: Radius.md + 2, padding: 1 },
  thumb: { width: 72, height: 72, borderRadius: Radius.md },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.three, marginTop: Spacing.two },
});
