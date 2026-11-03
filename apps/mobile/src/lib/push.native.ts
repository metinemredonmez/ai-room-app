import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { KEYS, prefs } from '@/lib/storage';

// "Tasarımın hazır" push (API.md §7.9). Permission is asked in context — when the user starts a
// generation — never at first launch. Expo Go cannot receive pushes on Android: try it on a dev build.

export const pushAvailable = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function deviceToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null; // no EAS project yet: pushes need one
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('designs', {
      name: 'Tasarımlar',
      // eslint-disable-next-line import/namespace -- re-exported from a .types module the import plugin can't follow; tsc checks it
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

async function register(): Promise<boolean> {
  const token = await deviceToken();
  if (!token) return false;
  await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  await prefs.set(KEYS.pushToken, token);
  return true;
}

/** On launch and after every sign-in: re-registers silently, only if permission was already given. */
export async function syncPush(): Promise<void> {
  const { granted } = await Notifications.getPermissionsAsync();
  if (granted) await register().catch(() => undefined);
}

/** Contextual ask (first generation). Returns whether this device will get "design ready" pushes. */
export async function enablePush(): Promise<boolean> {
  let { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (!granted && canAskAgain) ({ granted } = await Notifications.requestPermissionsAsync());
  return granted ? register().catch(() => false) : false;
}

/** Before sign-out: the old account stops pushing to this device. */
export async function disablePush(): Promise<void> {
  const token = await prefs.get(KEYS.pushToken);
  if (!token) return;
  await api.unregisterPushToken(token).catch(() => undefined);
  await prefs.remove(KEYS.pushToken);
}

/** Tapping a push opens that design. Only a well-formed id is taken from the payload, never a URL. */
export function onPushOpen(open: (designId: string) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const id = response?.notification.request.content.data?.designId;
    if (typeof id === 'string' && UUID.test(id)) open(id);
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
