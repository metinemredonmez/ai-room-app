import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, type Locale } from '@/lib/api';

// API.md §7.54: the coach reads its own reply aloud. One player for the screen; a new reply stops the previous one.
// The audio link is signed and expires within the hour, so it is kept per reply for 50 minutes and asked again after.
// Nothing here animates: the progress bar only changes width, so "Reduce Motion" needs no special case.

const LINK_TTL_MS = 50 * 60_000;

export type VoiceState = { id: string; status: 'loading' | 'playing' | 'paused' } | null;

export function useCoachVoice(locale: Locale, onError: (e: unknown) => void) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const links = useRef(new Map<string, { url: string; at: number }>());
  const [current, setCurrent] = useState<{ id: string; loading: boolean } | null>(null);

  useEffect(() => {
    // Plays even when the phone is on silent: the user asked to listen.
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    // The reply ended: the bar closes and the button goes back to "Listen".
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) setCurrent(null);
    });
    return () => sub.remove();
  }, [player]);

  const state: VoiceState = current
    ? { id: current.id, status: current.loading || (!status.isLoaded && !status.playing) ? 'loading' : status.playing ? 'playing' : 'paused' }
    : null;
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  const stop = useCallback(() => {
    player.pause();
    setCurrent(null);
  }, [player]);

  const toggle = useCallback(
    async (id: string, text: string, token: string) => {
      void Haptics.selectionAsync().catch(() => undefined);
      if (current?.id === id && !current.loading) {
        if (status.playing) player.pause();
        else player.play();
        return;
      }
      player.pause();
      setCurrent({ id, loading: true });
      try {
        let link = links.current.get(id);
        if (!link || Date.now() - link.at > LINK_TTL_MS) {
          const out = await api.speak(text, token, locale);
          link = { url: out.url, at: Date.now() };
          links.current.set(id, link);
        }
        player.replace({ uri: link.url });
        player.play();
        setCurrent({ id, loading: false });
      } catch (e) {
        setCurrent(null);
        links.current.delete(id);
        onError(e);
      }
    },
    [current, locale, onError, player, status.playing],
  );

  return { state, progress, toggle, stop };
}

export function ListenButton({ state, label, onPress }: { state: VoiceState; label: { listen: string; stop: string; resume: string }; onPress: () => void }) {
  const c = useTheme();
  const status = state?.status;
  const text = status === 'playing' ? label.stop : status === 'paused' ? label.resume : label.listen;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ busy: status === 'loading', selected: status === 'playing' }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.listen, { opacity: pressed ? 0.6 : 1 }]}>
      {status === 'loading' ? (
        <ActivityIndicator size="small" color={c.primary} />
      ) : (
        <Ionicons name={status === 'playing' ? 'pause' : 'volume-medium-outline'} size={16} color={c.primary} />
      )}
      <AppText variant="small" color={c.primary} style={{ fontWeight: '600' }}>
        {text}
      </AppText>
    </Pressable>
  );
}

/** The bar above the composer while the coach speaks: progress, pause/resume, close. */
export function VoiceBar({
  state,
  progress,
  title,
  labels,
  onToggle,
  onStop,
}: {
  state: VoiceState;
  progress: number;
  title: string;
  labels: { stop: string; resume: string; close: string };
  onToggle: () => void;
  onStop: () => void;
}) {
  const c = useTheme();
  if (!state || state.status === 'loading') return null;
  const playing = state.status === 'playing';
  return (
    <View style={[styles.bar, { backgroundColor: c.primarySoft }]} accessibilityLiveRegion="polite">
      <IconButton icon={playing ? 'pause' : 'play'} label={playing ? labels.stop : labels.resume} size={34} color={c.onPrimary} background={c.primary} onPress={onToggle} />
      <View style={{ flex: 1, gap: 6 }}>
        <AppText variant="small" color={c.primary} style={{ fontWeight: '600' }}>
          {title}
        </AppText>
        <View style={[styles.track, { backgroundColor: c.border }]}>
          <View style={[styles.fill, { backgroundColor: c.primary, width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>
      <IconButton icon="close" label={labels.close} size={30} onPress={onStop} />
    </View>
  );
}

const styles = StyleSheet.create({
  listen: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: Spacing.one },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.lg, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
});
