import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AppText, Button, Card, ErrorBanner, Segmented, confirmAsync } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Locale } from '@/lib/api';
import { formatDate } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function ProfileScreen() {
  const c = useTheme();
  const { t, user, locale, setLocale, signOut, deleteAccount, errorMessage, refreshUser } = useSession();
  const [busy, setBusy] = useState<'signout' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pro = user?.plan === 'PRO';

  const onSignOut = async () => {
    setBusy('signout');
    try {
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (!(await confirmAsync(t('profile.deleteConfirm'), t('common.delete'), t('common.cancel')))) return;
    setBusy('delete');
    try {
      await deleteAccount();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen tab onRefresh={refreshUser}>
      <AppText variant="title" style={{ marginBottom: Spacing.three }}>
        {t('profile.title')}
      </AppText>
      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: c.primarySoft }]}>
            <Ionicons name={user?.isGuest ? 'person-outline' : 'person'} size={24} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyBold">{user?.isGuest ? t('profile.guest') : user?.name || user?.email}</AppText>
            <AppText variant="small" muted>
              {user?.isGuest ? t('profile.guestHint') : user?.email}
            </AppText>
          </View>
        </View>
        {user?.isGuest ? (
          <Button label={t('profile.signIn')} icon="log-in-outline" onPress={() => router.push('/auth')} />
        ) : (
          <Button label={t('profile.signOut')} kind="secondary" icon="log-out-outline" loading={busy === 'signout'} onPress={onSignOut} />
        )}
      </Card>

      <Card style={{ marginTop: Spacing.three }}>
        <View style={styles.between}>
          <AppText variant="bodyBold">{t('profile.plan')}</AppText>
          <AppText variant="bodyBold" color={pro ? c.accent : c.text}>
            {pro ? t('profile.planPro') : t('profile.planFree')}
            {pro && user?.planExpiresAt ? ` · ${t('profile.until')} ${formatDate(user.planExpiresAt, locale)}` : ''}
          </AppText>
        </View>
        <View style={styles.between}>
          <AppText muted>{t('profile.dailyFree')}</AppText>
          <AppText variant="bodyBold">{user?.dailyFreeRemaining ?? 0}</AppText>
        </View>
        <View style={styles.between}>
          <AppText muted>{t('profile.credits')}</AppText>
          <AppText variant="bodyBold">{user?.credits ?? 0}</AppText>
        </View>
        {!pro ? <Button label={t('profile.upgrade')} kind="accent" icon="diamond" onPress={() => router.push('/paywall')} /> : null}
      </Card>

      <Card style={{ marginTop: Spacing.three }}>
        <AppText variant="bodyBold">{t('profile.language')}</AppText>
        <Segmented<Locale>
          value={locale}
          onChange={(l) => setLocale(l)}
          options={[
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' },
          ]}
        />
      </Card>

      <Card style={{ marginTop: Spacing.three }}>
        <View style={styles.row}>
          <Ionicons name="shield-checkmark-outline" size={20} color={c.primary} />
          <AppText variant="bodyBold">{t('profile.privacy')}</AppText>
        </View>
        <AppText variant="small" muted>
          {t('profile.privacyText')}
        </AppText>
        <Button label={t('profile.deleteAccount')} kind="danger" icon="trash-outline" loading={busy === 'delete'} onPress={onDelete} />
      </Card>

      <AppText variant="small" muted style={{ textAlign: 'center', marginTop: Spacing.four }}>
        {t('app.name')} · {t('profile.version')} {Constants.expoConfig?.version ?? '1.0.0'}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
