import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

const TIPS = ['create.tip1', 'create.tip2', 'create.tip3', 'create.tip4'] as const;

/** Full-screen progress while a design renders (up to ~60 s). Progress is an estimate. */
export function GeneratingOverlay({ visible }: { visible: boolean }) {
  const c = useTheme();
  const { t } = useSession();
  const [tip, setTip] = useState(0);
  const [progress] = useState(() => new Animated.Value(0));
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    const bar = Animated.timing(progress, {
      toValue: 0.94,
      duration: 50_000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    const rotate = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
    );
    bar.start();
    rotate.start();
    const timer = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4500);
    return () => {
      bar.stop();
      rotate.stop();
      clearInterval(timer);
    };
  }, [visible, progress, spin]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <LinearGradient colors={[c.primary, c.accent]} style={styles.orb}>
              <Ionicons name="sparkles" size={30} color="#fff" />
            </LinearGradient>
          </Animated.View>
          <AppText variant="heading" style={{ textAlign: 'center' }}>
            {t('create.progressTitle')}
          </AppText>
          <AppText muted style={{ textAlign: 'center', minHeight: 42 }}>
            {t(TIPS[tip])}
          </AppText>
          <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
            <Animated.View style={[styles.fill, { width, backgroundColor: c.primary }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
  },
  orb: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  track: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});
