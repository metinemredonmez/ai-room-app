import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, ErrorBanner, IconButton, Segmented, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

type Mode = 'login' | 'register';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { t, user, signIn, errorMessage } = useSession();
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const submit = async () => {
    const mail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail) || (mode === 'register' && password.length < 10) || !password) {
      setError(t('auth.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // With a guest bearer token attached, /auth/register upgrades the guest account in place.
      const auth =
        mode === 'register'
          ? await api.register({ email: mail, password, ...(name.trim() ? { name: name.trim() } : {}) })
          : await api.login({ email: mail, password });
      await signIn(auth);
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    const mail = email.trim().toLowerCase();
    setNotice(null);
    if (!EMAIL_RE.test(mail)) {
      setError(t('auth.forgotNeedEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(mail);
      setNotice(t('auth.forgotSent'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.five }]}>
        <View style={styles.inner}>
          <View style={styles.closeRow}>
            <IconButton icon="close" label={t('common.close')} onPress={close} />
          </View>
          <View style={[styles.logo, { backgroundColor: c.primary }]}>
            <Ionicons name="cube" size={30} color={c.onPrimary} />
          </View>
          <AppText variant="title" style={{ textAlign: 'center' }}>
            {mode === 'register' ? t('auth.register') : t('auth.login')}
          </AppText>
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'register', label: t('auth.register') },
              { value: 'login', label: t('auth.login') },
            ]}
          />
          {mode === 'register' ? (
            <TextField label={t('auth.name')} value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
          ) : null}
          <TextField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            maxLength={254}
          />
          <TextField
            label={`${t('auth.password')}${mode === 'register' ? ` · ${t('auth.passwordHint')}` : ''}`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            maxLength={128}
            onSubmitEditing={submit}
          />
          {error ? <ErrorBanner message={error} /> : null}
          {notice ? (
            <AppText variant="small" color={c.primary} style={{ textAlign: 'center' }}>
              {notice}
            </AppText>
          ) : null}
          <Button label={mode === 'register' ? t('auth.register') : t('auth.login')} size="lg" loading={busy} onPress={submit} />
          {mode === 'login' ? <Button label={t('auth.forgot')} kind="ghost" disabled={busy} onPress={forgot} /> : null}
          {mode === 'register' && user?.isGuest ? (
            <AppText variant="small" muted style={{ textAlign: 'center' }}>
              {t('auth.guestUpgrade')}
            </AppText>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 440, gap: Spacing.three },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
