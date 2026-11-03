import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function iconOrFallback(name: string | undefined, fallback: IconName = 'sparkles'): IconName {
  return name && name in Ionicons.glyphMap ? (name as IconName) : fallback;
}

// ---------------------------------------------------------------------------------------------
// Text

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyBold' | 'small' | 'smallBold' | 'caption';

const variantStyle: Record<Variant, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyBold: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallBold: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.4 },
};

export function AppText({
  variant = 'body',
  muted,
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const c = useTheme();
  return (
    <Text
      {...rest}
      style={[variantStyle[variant], { color: color ?? (muted ? c.textSecondary : c.text) }, style]}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Buttons

type ButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  kind?: 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'light';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: 'md' | 'lg';
};

export function Button({ label, onPress, icon, kind = 'primary', loading, disabled, style, size = 'md' }: ButtonProps) {
  const c = useTheme();
  const bg = {
    primary: c.primary,
    accent: c.accent,
    secondary: c.surfaceAlt,
    ghost: 'transparent',
    danger: 'transparent',
    light: '#FFFFFF', // on brand gradients, both themes
  }[kind];
  const fg = {
    primary: c.onPrimary,
    accent: '#FFFFFF',
    secondary: c.text,
    ghost: c.primary,
    danger: c.danger,
    light: '#1F6F5C',
  }[kind];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        size === 'lg' && styles.buttonLg,
        { backgroundColor: bg, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        kind === 'danger' && { borderWidth: 1, borderColor: c.danger },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'lg' ? 20 : 17} color={fg} /> : null}
          <AppText variant="bodyBold" color={fg}>
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  background,
  size = 40,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  color?: string;
  background?: string;
  size?: number;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background ?? c.surface,
          borderWidth: background ? 0 : StyleSheet.hairlineWidth,
          borderColor: c.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <Ionicons name={icon} size={size * 0.5} color={color ?? c.text} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------
// Containers

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useTheme();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="heading">{title}</AppText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <AppText variant="smallBold" color={c.primary}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  locked,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  locked?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.primary : c.surface,
          borderColor: selected ? c.primary : c.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? c.onPrimary : c.text} /> : null}
      <AppText variant="smallBold" color={selected ? c.onPrimary : c.text}>
        {label}
      </AppText>
      {locked ? <Ionicons name="lock-closed" size={12} color={selected ? c.onPrimary : c.accent} /> : null}
    </Pressable>
  );
}

export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'primary' | 'dark' }) {
  const c = useTheme();
  const bg = tone === 'accent' ? c.accent : tone === 'primary' ? c.primary : 'rgba(0,0,0,0.6)';
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppText variant="caption" color="#FFFFFF">
        {label}
      </AppText>
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && { backgroundColor: c.surface }]}>
            <AppText variant="smallBold" muted={!active}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextField({ label, ...props }: TextInputProps & { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      {label ? (
        <AppText variant="smallBold" muted>
          {label}
        </AppText>
      ) : null}
      <TextInput
        placeholderTextColor={c.textSecondary}
        {...props}
        style={[
          styles.input,
          { backgroundColor: c.surface, borderColor: c.border, color: c.text },
          props.multiline && { minHeight: 84, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
  );
}

export function PaletteBar({ colors, height = 10, radius = 6 }: { colors: string[]; height?: number; radius?: number }) {
  if (!colors.length) return null;
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: radius, overflow: 'hidden' }}>
      {colors.map((hex, i) => (
        <View key={`${hex}-${i}`} style={{ flex: 1, backgroundColor: hex }} />
      ))}
    </View>
  );
}

export function PaletteGradient({ colors, style, children }: { colors: string[]; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const stops = (colors.length >= 2 ? colors : [colors[0] ?? '#1F6F5C', '#E07A4F']) as [string, string, ...string[]];
  return (
    <LinearGradient colors={stops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primarySoft }]}>
        <Ionicons name={icon} size={30} color={c.primary} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {text ? (
        <AppText muted style={{ textAlign: 'center' }}>
          {text}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function ErrorBanner({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.errorBanner, { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
      <Ionicons name="alert-circle" size={18} color={c.danger} />
      <AppText variant="small" style={{ flex: 1 }}>
        {message}
      </AppText>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <AppText variant="smallBold" color={c.primary}>
            {retryLabel ?? '↻'}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Cross-platform dialogs (RN-web Alert has no buttons)

export function confirmAsync(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(message) ?? false);
  return new Promise((resolve) => {
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export function notify(message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message);
  else Alert.alert('', message);
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  buttonLg: { minHeight: 54, borderRadius: Radius.lg },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', borderRadius: Radius.md, padding: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: Radius.sm },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
});
