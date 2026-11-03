import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

export default function AppTabs() {
  const c = useTheme();
  const { t } = useSession();

  return (
    <NativeTabs
      backgroundColor={c.background}
      indicatorColor={c.primarySoft}
      tintColor={c.primary}
      labelStyle={{ selected: { color: c.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('tab.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inspire">
        <NativeTabs.Trigger.Label>{t('tab.inspire')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="designs">
        <NativeTabs.Trigger.Label>{t('tab.designs')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="grid_view" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>{t('tab.profile')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
