import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Badge, Button, ErrorBanner, IconButton, notify } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Plan } from '@/lib/api';
import { formatTRY, type MessageKey } from '@/lib/i18n';
import { buy, restore, storeBillingAvailable, storePackages, type StorePackage } from '@/lib/purchases';
import { useSession } from '@/lib/session';

const PERIOD_KEY: Record<Plan['period'], MessageKey> = {
  week: 'paywall.week',
  month: 'paywall.month',
  year: 'paywall.year',
};
const WEEKS: Record<Plan['period'], number> = { week: 1, month: 52 / 12, year: 52 };

export default function PaywallScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale, catalog, user, setUser, errorMessage } = useSession();
  const plans = catalog?.plans ?? [];
  const [selected, setSelected] = useState<string | undefined>(
    plans.find((p) => p.badge)?.id ?? plans[0]?.id,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Store billing (RevenueCat) on iOS/Android dev & store builds; the demo upgrade only where it's absent.
  const [packages, setPackages] = useState<StorePackage[]>([]);
  useEffect(() => {
    if (!storeBillingAvailable || !user) return;
    storePackages(user.id)
      .then(setPackages)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [user, errorMessage]);
  const packageFor = (plan: Plan) => packages.find((p) => p.productId === plan.storeProductId || p.productId.startsWith(`${plan.storeProductId}:`));

  const purchase = async () => {
    setBusy(true);
    setError(null);
    try {
      if (storeBillingAvailable && user) {
        const plan = plans.find((p) => p.id === selected);
        const pkg = plan ? packageFor(plan) : undefined;
        if (!pkg) {
          setError(t('paywall.storeMissing'));
          return;
        }
        if ((await buy(user.id, pkg)) === 'cancelled') return;
        // PRO is granted server-side from RevenueCat (webhook / REST), never by the app itself.
        setUser(await api.billingSync());
      } else {
        setUser(await api.devUpgrade());
      }
      notify(t('paywall.success'));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    if (!storeBillingAvailable || !user) {
      notify(t('paywall.restoreInfo'));
      return;
    }
    setBusy(true);
    try {
      await restore(user.id);
      setUser(await api.billingSync());
      notify(t('paywall.restored'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const benefits = ['paywall.b1', 'paywall.b2', 'paywall.b3', 'paywall.b4', 'paywall.b5'] as const;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.five }]}>
        <View style={styles.inner}>
          <View style={styles.closeRow}>
            <IconButton icon="close" label={t('common.close')} onPress={close} />
          </View>
          <LinearGradient colors={[c.primary, '#2E8A72', c.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Ionicons name="diamond" size={40} color="#fff" />
            <AppText variant="title" color="#fff" style={{ textAlign: 'center' }}>
              {t('paywall.title')}
            </AppText>
            <AppText color="rgba(255,255,255,0.92)" style={{ textAlign: 'center' }}>
              {t('paywall.subtitle')}
            </AppText>
          </LinearGradient>

          <View style={{ gap: Spacing.two }}>
            {benefits.map((k) => (
              <View key={k} style={styles.benefit}>
                <Ionicons name="checkmark-circle" size={20} color={c.primary} />
                <AppText style={{ flex: 1 }}>{t(k)}</AppText>
              </View>
            ))}
          </View>

          <View style={styles.plans}>
            {plans.map((p) => {
              const active = p.id === selected;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => setSelected(p.id)}
                  style={[
                    styles.plan,
                    { backgroundColor: c.surface, borderColor: active ? c.primary : c.border },
                    active && { borderWidth: 2 },
                  ]}>
                  {p.badge ? (
                    <View style={styles.planBadge}>
                      <Badge label={p.badge} tone={active ? 'primary' : 'accent'} />
                    </View>
                  ) : null}
                  <AppText variant="bodyBold" color={active ? c.primary : c.text}>
                    {p.name || t(PERIOD_KEY[p.period])}
                  </AppText>
                  <AppText variant="heading">{packageFor(p)?.priceString ?? formatTRY(p.priceTRY, locale)}</AppText>
                  <AppText variant="small" muted>
                    {formatTRY(p.priceTRY / WEEKS[p.period], locale)}
                    {t('paywall.perWeek')}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {error ? <ErrorBanner message={error} /> : null}

          <Button label={t('common.continue')} size="lg" loading={busy} disabled={!selected} onPress={purchase} />
          <View style={styles.secure}>
            <Ionicons name="lock-closed" size={13} color={c.textSecondary} />
            <AppText variant="small" muted>
              {t('paywall.cancelAnytime')}
            </AppText>
          </View>
          <AppText variant="small" muted style={{ textAlign: 'center' }}>
            {storeBillingAvailable ? t('paywall.store') : t('paywall.demo')}
          </AppText>

          <View style={styles.links}>
            <Pressable onPress={onRestore} accessibilityRole="link">
              <AppText variant="small" muted>
                {t('paywall.restore')}
              </AppText>
            </Pressable>
            <AppText variant="small" muted>
              ·
            </AppText>
            <Pressable onPress={() => notify(t('profile.privacyText'))} accessibilityRole="link">
              <AppText variant="small" muted>
                {t('paywall.terms')}
              </AppText>
            </Pressable>
            <AppText variant="small" muted>
              ·
            </AppText>
            <Pressable onPress={() => notify(t('profile.privacyText'))} accessibilityRole="link">
              <AppText variant="small" muted>
                {t('paywall.privacy')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 520, gap: Spacing.four },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  hero: { borderRadius: 24, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  plans: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  plan: {
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: 4,
  },
  planBadge: { position: 'absolute', top: -10 },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -Spacing.two },
  links: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two, flexWrap: 'wrap' },
});

