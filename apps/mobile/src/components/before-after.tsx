import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/ui';
import { Radius } from '@/constants/theme';

/**
 * Drag (or tap) to compare. Uses the plain responder system, which behaves the same on iOS,
 * Android and web. All children start at x=0, so `locationX` is the position inside the frame.
 */
export function BeforeAfter({
  beforeUri,
  afterUri,
  aspectRatio,
  beforeLabel,
  afterLabel,
}: {
  beforeUri: string;
  afterUri: string;
  aspectRatio: number;
  beforeLabel: string;
  afterLabel: string;
}) {
  const [width, setWidth] = useState(0);
  const [pos, setPos] = useState(0.5);

  const update = (next: number) => setPos(Math.min(1, Math.max(0, next)));
  const track = (e: GestureResponderEvent) => {
    if (width > 0) update(e.nativeEvent.locationX / width);
  };
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const ratio = Math.min(2, Math.max(0.5, aspectRatio || 4 / 3));
  const height = width / ratio;

  return (
    <View
      onLayout={onLayout}
      style={[styles.frame, { aspectRatio: ratio }]}
      accessibilityLabel={`${beforeLabel} / ${afterLabel}`}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pos * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => update(pos + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1))}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={track}
      onResponderMove={track}>
      <Image source={{ uri: afterUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      {width > 0 ? (
        <View style={[styles.beforeClip, { width: width * pos }]} pointerEvents="none">
          <Image source={{ uri: beforeUri }} style={{ width, height }} contentFit="cover" />
        </View>
      ) : null}
      <View style={styles.labelLeft} pointerEvents="none">
        <AppText variant="caption" color="#fff">
          {beforeLabel.toUpperCase()}
        </AppText>
      </View>
      <View style={styles.labelRight} pointerEvents="none">
        <AppText variant="caption" color="#fff">
          {afterLabel.toUpperCase()}
        </AppText>
      </View>
      {width > 0 ? (
        <View style={[styles.divider, { left: width * pos - 1 }]} pointerEvents="none">
          <View style={styles.handle}>
            <Ionicons name="code-outline" size={18} color="#141414" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: '#222' },
  beforeClip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  divider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  },
  labelLeft: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelRight: {
    position: 'absolute',
    right: 10,
    top: 10,
    backgroundColor: 'rgba(31,111,92,0.85)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
});
