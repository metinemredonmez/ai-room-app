import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, TabList, TabSlot, TabTrigger, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, type IconName } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

export default function AppTabs() {
  const { t } = useSession();
  return (
    <Tabs>
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="home">{t('tab.home')}</TabButton>
          </TabTrigger>
          <TabTrigger name="inspire" href="/inspire" asChild>
            <TabButton icon="sparkles">{t('tab.inspire')}</TabButton>
          </TabTrigger>
          <TabTrigger name="designs" href="/designs" asChild>
            <TabButton icon="grid">{t('tab.designs')}</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon="person-circle">{t('tab.profile')}</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
      <TabSlot style={{ flex: 1 }} />
    </Tabs>
  );
}

function TabButton({ children, isFocused, icon, onPress, onLongPress }: TabTriggerSlotProps & { icon: IconName }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.tabButton, isFocused && { backgroundColor: c.primarySoft }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={16} color={isFocused ? c.primary : c.textSecondary} />
      <AppText variant="smallBold" color={isFocused ? c.primary : c.textSecondary}>
        {children}
      </AppText>
    </Pressable>
  );
}

function CustomTabList(props: TabListProps) {
  const c = useTheme();
  const { t } = useSession();
  return (
    <View style={[styles.bar, { backgroundColor: c.background, borderBottomColor: c.border }]}>
      <View style={styles.inner}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: c.primary }]}>
            <Ionicons name="cube" size={14} color={c.onPrimary} />
          </View>
          <AppText variant="bodyBold">{t('app.name')}</AppText>
        </View>
        <View style={styles.tabs}>{props.children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%', borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginRight: 'auto' },
  logo: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
});
