import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListenButton, VoiceBar, useCoachVoice } from '@/components/coach-voice';
import { AppText, Chip, ErrorBanner, IconButton } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type ChatMessage, type CrisisLine, type Suggestion } from '@/lib/api';
import { pickAndUpload } from '@/lib/pick-image';
import { useSession } from '@/lib/session';

type Attached = { id: string; url: string };
type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: Attached;
  /** API.md §7.54: lets this reply be read aloud. */
  speakToken?: string;
  crisis?: { lines: CrisisLine[] };
};

let seq = 0;
const nextId = () => `m${++seq}`;

export default function ChatScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ imageId?: string; imageUrl?: string }>();
  const { t, locale, errorMessage } = useSession();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pending, setPending] = useState<Attached | null>(
    params.imageId && params.imageUrl ? { id: params.imageId, url: params.imageUrl } : null,
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const onVoiceError = useCallback((e: unknown) => setError(errorMessage(e)), [errorMessage]);
  const voice = useCoachVoice(locale, onVoiceError);

  const lastImage = [...messages].reverse().find((m) => m.image)?.image ?? pending ?? null;

  const send = async (raw: string) => {
    const text =
      raw.trim() ||
      (pending ? (locale === 'tr' ? 'Bu oda için ne önerirsin?' : 'What would you suggest for this room?') : '');
    if (!text || sending) return;
    const next: UiMessage[] = [...messages, { id: nextId(), role: 'user', text: text.slice(0, 2000), image: pending ?? undefined }];
    setMessages(next);
    setInput('');
    setPending(null);
    setSuggestions([]);
    setError(null);
    setSending(true);
    try {
      const payload: ChatMessage[] = next.map((m) => ({ role: m.role, text: m.text, ...(m.image ? { imageId: m.image.id } : {}) }));
      const res = await api.chat(payload, locale);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: res.reply, speakToken: res.speakToken, crisis: res.crisis },
      ]);
      setSuggestions(res.suggestions);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'insufficient_credits') router.push('/paywall');
      setError(errorMessage(e));
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const attach = async () => {
    setAttaching(true);
    setError(null);
    try {
      const image = await pickAndUpload('library');
      if (image) setPending({ id: image.id, url: image.url });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAttaching(false);
    }
  };

  // AI-01: a suggestion only pre-fills the create screen; the user starts the generation.
  const openSuggestion = (s: Suggestion) =>
    router.push({
      pathname: '/create',
      params: {
        tool: s.tool,
        ...(s.styleId ? { styleId: s.styleId } : {}),
        ...(s.roomId ? { roomId: s.roomId } : {}),
        ...(s.instructions ? { instructions: s.instructions } : {}),
        ...(lastImage ? { imageId: lastImage.id, imageUrl: lastImage.url } : {}),
      },
    });

  const quick = [t('chat.q1'), t('chat.q2'), t('chat.q3')];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        <View style={styles.inner}>
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <LinearGradient colors={[c.primary, c.accent]} style={styles.orb}>
                <Ionicons name="sparkles" size={30} color="#fff" />
              </LinearGradient>
              <AppText variant="heading" style={{ textAlign: 'center' }}>
                {t('chat.introTitle')}
              </AppText>
              {(['chat.intro1', 'chat.intro2', 'chat.intro3'] as const).map((k, i) => (
                <View key={k} style={styles.introRow}>
                  <Ionicons
                    name={(['list-outline', 'images-outline', 'color-wand-outline'] as const)[i]}
                    size={18}
                    color={c.primary}
                  />
                  <AppText>{t(k)}</AppText>
                </View>
              ))}
              <View style={styles.quick}>
                {quick.map((q) => (
                  <Chip key={q} label={q} onPress={() => send(q)} />
                ))}
              </View>
            </View>
          ) : null}

          {messages.map((m) => (
            <View key={m.id} style={{ gap: Spacing.one, alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%' }}>
            <View
              style={[
                styles.bubble,
                m.role === 'user'
                  ? { alignSelf: 'flex-end', backgroundColor: c.primary }
                  : { alignSelf: 'flex-start', backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth },
              ]}>
              {m.image ? <Image source={{ uri: m.image.url }} style={styles.bubbleImage} contentFit="cover" /> : null}
              {/* Plain text only — model output is never rendered as markup (AI-02). */}
              <AppText selectable color={m.role === 'user' ? c.onPrimary : c.text}>
                {m.text}
              </AppText>
            </View>
            {m.crisis ? (
              <View style={[styles.crisis, { borderColor: c.danger }]}>
                <AppText variant="bodyBold">{t('chat.crisisTitle')}</AppText>
                {m.crisis.lines.map((l) => (
                  <Pressable
                    key={`${l.phone}-${l.label}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('chat.call')}: ${l.label} ${l.phone}`}
                    onPress={() => void Linking.openURL(`tel:${l.phone.replace(/\s/g, '')}`)}
                    style={({ pressed }) => [styles.callButton, { backgroundColor: c.danger, opacity: pressed ? 0.8 : 1 }]}>
                    <Ionicons name="call" size={16} color="#fff" />
                    <AppText color="#fff" style={{ fontWeight: '600', flexShrink: 1 }}>
                      {l.label} · {l.phone}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {m.speakToken ? (
              <ListenButton
                state={voice.state?.id === m.id ? voice.state : null}
                label={{ listen: t('chat.listen'), stop: t('chat.stop'), resume: t('chat.resume') }}
                onPress={() => void voice.toggle(m.id, m.text, m.speakToken!)}
              />
            ) : null}
            </View>
          ))}

          {sending ? <ActivityIndicator color={c.primary} style={{ alignSelf: 'flex-start', margin: Spacing.two }} /> : null}

          {suggestions.length ? (
            <View style={{ gap: Spacing.two }}>
              <View style={styles.quick}>
                {suggestions.map((s, i) => (
                  <Chip key={`${s.label}-${i}`} label={s.label} icon="sparkles-outline" onPress={() => openSuggestion(s)} />
                ))}
              </View>
              <AppText variant="small" muted>
                {t('chat.suggestionHint')}
              </AppText>
            </View>
          ) : null}

          {error ? <ErrorBanner message={error} /> : null}
        </View>
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.background, paddingBottom: insets.bottom + Spacing.two }]}>
        <View style={styles.inner}>
          <VoiceBar
            state={voice.state}
            progress={voice.progress}
            title={t('chat.nowPlaying')}
            labels={{ stop: t('chat.stop'), resume: t('chat.resume'), close: t('common.close') }}
            onToggle={() => {
              const m = messages.find((x) => x.id === voice.state?.id);
              if (m?.speakToken) void voice.toggle(m.id, m.text, m.speakToken);
            }}
            onStop={voice.stop}
          />
          {pending ? (
            <View style={styles.pending}>
              <Image source={{ uri: pending.url }} style={styles.pendingImage} contentFit="cover" />
              <AppText variant="small" muted style={{ flex: 1 }}>
                {t('chat.imageAttached')}
              </AppText>
              <IconButton icon="close" label={t('common.close')} size={30} onPress={() => setPending(null)} />
            </View>
          ) : null}
          <View style={[styles.inputRow, { backgroundColor: c.surface, borderColor: c.border }]}>
            {attaching ? (
              <ActivityIndicator color={c.primary} style={{ width: 36 }} />
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={t('chat.attach')} onPress={attach} hitSlop={8} style={styles.iconTap}>
                <Ionicons name="add" size={24} color={c.text} />
              </Pressable>
            )}
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={c.textSecondary}
              style={[styles.input, { color: c.text }]}
              multiline
              maxLength={2000}
              onSubmitEditing={() => send(input)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="send"
              disabled={sending || (!input.trim() && !pending)}
              onPress={() => send(input)}
              style={[styles.send, { backgroundColor: input.trim() || pending ? c.primary : c.surfaceAlt }]}>
              <Ionicons name="arrow-up" size={18} color={input.trim() || pending ? c.onPrimary : c.textSecondary} />
            </Pressable>
          </View>
          <AppText variant="caption" muted style={{ textAlign: 'center', fontWeight: '400' }}>
            {t('chat.disclaimer')}
          </AppText>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  intro: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.five },
  orb: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  bubble: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  crisis: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  callButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bubbleImage: { width: 200, height: 150, borderRadius: Radius.md },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, alignItems: 'center' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pendingImage: { width: 44, height: 44, borderRadius: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  iconTap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 15, maxHeight: 120, paddingVertical: 8, paddingHorizontal: 4 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
