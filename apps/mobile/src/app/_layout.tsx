import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function BootGate() {
  const { status, t, retryBoot, onboardingDone } = useSession();
  const c = useTheme();
  const segments = useSegments();

  useEffect(() => {
    if (status !== 'booting') SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (status === 'ready' && !onboardingDone && segments[0] !== 'onboarding') {
      router.replace('/onboarding');
    }
  }, [status, onboardingDone, segments]);

  if (status === 'booting') {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <AppText variant="title" color={c.primary}>
          {t('app.name')}
        </AppText>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (status === 'offline') {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('boot.offline')}
          text={t('boot.offlineHint')}
          action={<Button label={t('common.retry')} icon="refresh" onPress={retryBoot} />}
        />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerTintColor: c.text,
        headerStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.background },
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="create" options={{ title: t('create.title') }} />
      <Stack.Screen name="design/[id]" options={{ title: t('design.title') }} />
      <Stack.Screen name="chat" options={{ title: t('chat.title') }} />
      <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="auth" options={{ presentation: 'modal', headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const palette = dark ? Colors.dark : Colors.light;
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
    },
  };
  return (
    <ThemeProvider value={navTheme}>
      <SessionProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <BootGate />
      </SessionProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
