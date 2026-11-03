import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Scrollable, width-capped page used by every tab screen. */
export function Screen({
  children,
  tab,
  refreshing,
  onRefresh,
  contentStyle,
  footer,
}: {
  children: ReactNode;
  tab?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const top = tab && Platform.OS !== 'web' ? insets.top + Spacing.two : Spacing.three;
  const bottom = (tab ? BottomTabInset : 0) + insets.bottom + Spacing.six;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.primary} /> : undefined
        }
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: bottom }]}>
        <View style={[styles.inner, contentStyle]}>{children}</View>
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: Spacing.three },
  inner: { width: '100%', maxWidth: MaxContentWidth },
});
