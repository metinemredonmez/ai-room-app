import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MessageKey } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const SLIDES: { icon: IconName; title: MessageKey; text: MessageKey; colors: [string, string] }[] = [
  { icon: 'camera', title: 'onboarding.s1Title', text: 'onboarding.s1Text', colors: ['#1F6F5C', '#3FB28F'] },
  { icon: 'color-palette', title: 'onboarding.s2Title', text: 'onboarding.s2Text', colors: ['#2E8A72', '#E07A4F'] },
  { icon: 'bag-handle', title: 'onboarding.s3Title', text: 'onboarding.s3Text', colors: ['#E07A4F', '#C25B34'] },
];

export default function OnboardingScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t, completeOnboarding } = useSession();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // While "İleri" animates the scroll, intermediate offsets must not drag the index back.
  const targetRef = useRef<number | null>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (targetRef.current !== null) {
      if (i === targetRef.current) targetRef.current = null;
      return;
    }
    if (i !== index) setIndex(i);
  };

  const next = async () => {
    if (index < SLIDES.length - 1) {
      targetRef.current = index + 1;
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
      setIndex(index + 1);
      return;
    }
    await completeOnboarding();
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top, paddingBottom: insets.bottom + Spacing.three }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        style={{ flex: 1 }}>
        {SLIDES.map((s) => (
          <View key={s.title} style={[styles.slide, { width }]}>
            <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.art}>
              <Ionicons name={s.icon} size={88} color="#fff" />
            </LinearGradient>
            <AppText variant="display" style={{ textAlign: 'center' }}>
              {t(s.title)}
            </AppText>
            <AppText muted style={{ textAlign: 'center', maxWidth: 360 }}>
              {t(s.text)}
            </AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.title} style={[styles.dot, { backgroundColor: i === index ? c.primary : c.border, width: i === index ? 22 : 8 }]} />
          ))}
        </View>
        <Button
          label={index === SLIDES.length - 1 ? t('onboarding.start') : t('onboarding.next')}
          size="lg"
          onPress={next}
          style={{ alignSelf: 'stretch' }}
        />
        <AppText variant="small" muted style={{ textAlign: 'center' }}>
          {t('onboarding.consent')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  art: { width: 220, height: 220, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.three },
  footer: { paddingHorizontal: Spacing.four, gap: Spacing.three, alignItems: 'center', width: '100%', maxWidth: 520, alignSelf: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
});
