import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, PaletteBar } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Analysis } from '@/lib/api';
import { formatRangeTRY } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Store links come from the backend; only http(s) URLs are opened. */
function openLink(url: string) {
  if (/^https?:\/\//i.test(url)) Linking.openURL(url).catch(() => undefined);
}

export function AnalysisView({ analysis }: { analysis: Analysis }) {
  const c = useTheme();
  const { t, locale } = useSession();
  const { totals } = analysis;

  return (
    <View style={{ gap: Spacing.three }}>
      <Card>
        <AppText variant="heading">{t('analysis.title')}</AppText>
        <AppText muted>{analysis.summary}</AppText>
        {analysis.palette.length ? (
          <View style={{ gap: Spacing.one }}>
            <AppText variant="smallBold" muted>
              {t('analysis.palette')}
            </AppText>
            <PaletteBar colors={analysis.palette} height={16} radius={8} />
          </View>
        ) : null}
      </Card>

      <AppText variant="heading">{t('analysis.items')}</AppText>
      {analysis.items.map((item, i) => (
        <Card key={`${item.name}-${i}`}>
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyBold">{item.name}</AppText>
              <AppText variant="small" muted>
                {[item.category, item.material, item.color].filter(Boolean).join(' · ')}
                {item.quantity > 1 ? ` · ${item.quantity} ${t('analysis.qty')}` : ''}
              </AppText>
            </View>
            <AppText variant="bodyBold" color={c.primary} style={{ textAlign: 'right' }}>
              {formatRangeTRY(item.priceMinTRY, item.priceMaxTRY, locale)}
            </AppText>
          </View>
          {item.links.length ? (
            <View style={styles.links}>
              {item.links.map((link) => (
                <Pressable
                  key={link.store}
                  accessibilityRole="link"
                  onPress={() => openLink(link.url)}
                  style={({ pressed }) => [styles.link, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
                  <Ionicons name="bag-handle-outline" size={13} color={c.primary} />
                  <AppText variant="smallBold" color={c.primary}>
                    {link.store}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      ))}

      {analysis.renovation.length ? (
        <>
          <AppText variant="heading">{t('analysis.renovation')}</AppText>
          <Card style={{ gap: 0, paddingVertical: Spacing.one }}>
            {analysis.renovation.map((r, i) => (
              <View
                key={`${r.task}-${i}`}
                style={[styles.renoRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyBold">{r.task}</AppText>
                  <AppText variant="small" muted>
                    {r.quantity} {r.unit}
                  </AppText>
                </View>
                <AppText variant="smallBold">{formatRangeTRY(r.costMinTRY, r.costMaxTRY, locale)}</AppText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Card style={{ backgroundColor: c.primarySoft, borderColor: c.primarySoft }}>
        <AppText variant="heading">{t('analysis.totals')}</AppText>
        <View style={styles.between}>
          <AppText muted>{t('analysis.furniture')}</AppText>
          <AppText variant="bodyBold">{formatRangeTRY(totals.furnitureMinTRY, totals.furnitureMaxTRY, locale)}</AppText>
        </View>
        <View style={styles.between}>
          <AppText muted>{t('analysis.reno')}</AppText>
          <AppText variant="bodyBold">{formatRangeTRY(totals.renovationMinTRY, totals.renovationMaxTRY, locale)}</AppText>
        </View>
        <View style={[styles.between, { marginTop: Spacing.one }]}>
          <AppText variant="bodyBold">{t('analysis.grand')}</AppText>
          <AppText variant="heading" color={c.primary}>
            {formatRangeTRY(totals.grandMinTRY, totals.grandMaxTRY, locale)}
          </AppText>
        </View>
      </Card>
      <AppText variant="small" muted>
        {analysis.disclaimer}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  renoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
});
