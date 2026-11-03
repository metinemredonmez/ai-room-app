import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { StyleCard, ToolCard, isPro, openPaywall } from '@/components/catalog-cards';
import { GeneratingOverlay } from '@/components/generating-overlay';
import { Screen } from '@/components/screen';
import { AppText, Button, Card, Chip, ErrorBanner, SectionHeader, TextField, iconOrFallback } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type CreateDesign, type ImageRef, type SampleId, type ToolId } from '@/lib/api';
import { pickAndUpload, type PickSource } from '@/lib/pick-image';
import { useSession } from '@/lib/session';

type Params = {
  tool?: string;
  styleId?: string;
  roomId?: string;
  instructions?: string;
  imageId?: string;
  imageUrl?: string;
  imageW?: string;
  imageH?: string;
};

function sampleFor(tool: ToolId): SampleId {
  if (tool === 'exterior') return 'exterior';
  if (tool === 'garden') return 'garden';
  if (tool === 'furnish') return 'empty_room';
  return 'living_room';
}

export default function CreateScreen() {
  const c = useTheme();
  const params = useLocalSearchParams<Params>();
  const { catalog, user, t, errorMessage, refreshUser } = useSession();
  const pro = isPro(user);

  const [toolId, setToolId] = useState<ToolId | null>(
    catalog?.tools.some((x) => x.id === params.tool) ? (params.tool as ToolId) : null,
  );
  const tool = catalog?.tools.find((x) => x.id === toolId) ?? null;

  const [photo, setPhoto] = useState<ImageRef | null>(
    params.imageId && params.imageUrl
      ? { id: params.imageId, url: params.imageUrl, width: Number(params.imageW) || 1024, height: Number(params.imageH) || 768 }
      : null,
  );
  const [reference, setReference] = useState<ImageRef | null>(null);
  const [uploading, setUploading] = useState<'photo' | 'reference' | null>(null);
  const [styleId, setStyleId] = useState<string | undefined>(
    catalog?.styles.some((s) => s.id === params.styleId) ? params.styleId : catalog?.styles.find((s) => !s.isPro)?.id,
  );
  const [roomId, setRoomId] = useState<string | undefined>(
    catalog?.rooms.some((r) => r.id === params.roomId) ? params.roomId : catalog?.rooms[0]?.id,
  );
  const [floorId, setFloorId] = useState<string | undefined>(catalog?.floors[0]?.id);
  const [colorId, setColorId] = useState<string | undefined>(catalog?.colors[0]?.id);
  const [target, setTarget] = useState('');
  const [replacement, setReplacement] = useState('');
  const [instructions, setInstructions] = useState(params.instructions ?? '');
  const [removeAll, setRemoveAll] = useState(false);
  const [variants, setVariants] = useState<1 | 2 | 3 | 4>(2);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const color = useMemo(() => catalog?.colors.find((x) => x.id === colorId), [catalog, colorId]);

  const handleError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'insufficient_credits') {
      openPaywall();
      return;
    }
    if (e instanceof ApiError && e.code === 'camera_denied') return setError(t('create.cameraDenied'));
    if (e instanceof ApiError && e.code === 'payload_too_large') return setError(t('create.tooLarge'));
    setError(errorMessage(e));
  };

  const pick = async (source: PickSource, kind: 'photo' | 'reference') => {
    setError(null);
    setUploading(kind);
    try {
      const image = await pickAndUpload(source);
      if (image) (kind === 'photo' ? setPhoto : setReference)(image);
    } catch (e) {
      handleError(e);
    } finally {
      setUploading(null);
    }
  };

  const pickSample = async () => {
    if (!toolId) return;
    setError(null);
    setUploading('photo');
    try {
      setPhoto((await api.uploadSample(sampleFor(toolId))).image);
    } catch (e) {
      handleError(e);
    } finally {
      setUploading(null);
    }
  };

  const generate = async () => {
    if (!tool) return;
    if (!photo) return setError(t('create.needPhoto'));
    if (tool.needs.reference && !reference) return setError(t('create.needReference'));
    if (tool.isPro && !pro) return openPaywall();
    const style = catalog?.styles.find((s) => s.id === styleId);
    if (tool.needs.style && style?.isPro && !pro) return openPaywall();

    const body: CreateDesign = { tool: tool.id, inputImageId: photo.id, variants };
    if (tool.needs.style && styleId) body.styleId = styleId;
    if (tool.needs.room && roomId) body.roomId = roomId;
    if (tool.needs.floor && floorId) body.floorId = floorId;
    if (tool.needs.color && color) {
      body.colorHex = color.hex;
      body.colorName = color.name;
    }
    if (tool.needs.removeAll) body.removeAll = removeAll;
    if (tool.needs.target && target.trim() && !(tool.needs.removeAll && removeAll)) body.target = target.trim().slice(0, 120);
    if (tool.needs.replacement && replacement.trim()) body.replacement = replacement.trim().slice(0, 120);
    if (tool.needs.instructions && instructions.trim()) body.instructions = instructions.trim().slice(0, 300);
    if (tool.needs.reference && reference) body.referenceImageId = reference.id;

    setError(null);
    setGenerating(true);
    try {
      const design = await api.createDesign(body);
      refreshUser();
      setGenerating(false);
      router.replace({ pathname: '/design/[id]', params: { id: design.id } });
    } catch (e) {
      setGenerating(false);
      refreshUser();
      handleError(e);
    }
  };

  if (!catalog) return null;

  // Step 1: tool picker (when the screen was opened without a tool)
  if (!tool) {
    return (
      <Screen>
        <SectionHeader title={t('create.stepTool')} />
        <View style={styles.grid}>
          {catalog.tools.map((x) => (
            <ToolCard key={x.id} tool={x} onPress={() => (x.isPro && !pro ? openPaywall() : setToolId(x.id))} />
          ))}
        </View>
      </Screen>
    );
  }

  const cost = variants;
  const photoAspect = photo ? photo.width / Math.max(1, photo.height) : 4 / 3;

  return (
    <Screen>
      <Card style={styles.toolHeader}>
        <View style={[styles.toolIcon, { backgroundColor: c.primarySoft }]}>
          <Ionicons name={iconOrFallback(tool.icon)} size={22} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyBold">{tool.name}</AppText>
          <AppText variant="small" muted numberOfLines={2}>
            {tool.description}
          </AppText>
        </View>
        {!params.tool ? (
          <Pressable onPress={() => setToolId(null)} hitSlop={8} accessibilityRole="button">
            <AppText variant="smallBold" color={c.primary}>
              {t('create.change')}
            </AppText>
          </Pressable>
        ) : null}
      </Card>

      <SectionHeader title={t('create.stepPhoto')} />
      {photo ? (
        <View style={{ gap: Spacing.two }}>
          <Image source={{ uri: photo.url }} style={[styles.photo, { aspectRatio: Math.min(2, Math.max(0.6, photoAspect)) }]} contentFit="cover" />
          <Button label={t('create.change')} kind="secondary" icon="swap-horizontal" onPress={() => setPhoto(null)} />
        </View>
      ) : (
        <Card>
          <View style={styles.photoActions}>
            <Button
              label={t('create.library')}
              icon="images-outline"
              loading={uploading === 'photo'}
              style={{ flexGrow: 1 }}
              onPress={() => pick('library', 'photo')}
            />
            {Platform.OS !== 'web' ? (
              <Button
                label={t('create.camera')}
                icon="camera-outline"
                kind="secondary"
                disabled={uploading !== null}
                style={{ flexGrow: 1 }}
                onPress={() => pick('camera', 'photo')}
              />
            ) : null}
          </View>
          <Button label={t('create.sample')} icon="image-outline" kind="ghost" disabled={uploading !== null} onPress={pickSample} />
          <AppText variant="small" muted>
            {uploading === 'photo' ? t('create.uploading') : t('create.photoHint')}
          </AppText>
        </Card>
      )}

      <SectionHeader title={t('create.stepOptions')} />
      <View style={{ gap: Spacing.three }}>
        {tool.needs.room ? (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="smallBold" muted>
              {t('create.room')}
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {catalog.rooms.map((r) => (
                <Chip
                  key={r.id}
                  label={r.name}
                  icon={iconOrFallback(r.icon, 'home-outline')}
                  selected={roomId === r.id}
                  onPress={() => setRoomId(r.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {tool.needs.style ? (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="smallBold" muted>
              {t('create.style')}
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {catalog.styles.map((s) => (
                <View
                  key={s.id}
                  style={[styles.styleWrap, { borderColor: styleId === s.id ? c.primary : 'transparent' }]}>
                  <StyleCard
                    style={s}
                    width={128}
                    locked={s.isPro && !pro}
                    onPress={() => (s.isPro && !pro ? openPaywall() : setStyleId(s.id))}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {tool.needs.floor ? (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="smallBold" muted>
              {t('create.floor')}
            </AppText>
            <View style={styles.wrap}>
              {catalog.floors.map((f) => (
                <Chip key={f.id} label={f.name} selected={floorId === f.id} onPress={() => setFloorId(f.id)} />
              ))}
            </View>
          </View>
        ) : null}

        {tool.needs.color ? (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="smallBold" muted>
              {t('create.color')} {color ? `· ${color.name}` : ''}
            </AppText>
            <View style={styles.wrap}>
              {catalog.colors.map((col) => (
                <Pressable
                  key={col.id}
                  accessibilityRole="button"
                  accessibilityLabel={col.name}
                  accessibilityState={{ selected: colorId === col.id }}
                  onPress={() => setColorId(col.id)}
                  style={[
                    styles.swatch,
                    { backgroundColor: col.hex, borderColor: colorId === col.id ? c.primary : c.border },
                    colorId === col.id && { borderWidth: 3 },
                  ]}
                />
              ))}
            </View>
          </View>
        ) : null}

        {tool.needs.removeAll ? (
          <Card style={styles.switchRow}>
            <AppText variant="bodyBold" style={{ flex: 1 }}>
              {t('create.removeAll')}
            </AppText>
            <Switch value={removeAll} onValueChange={setRemoveAll} trackColor={{ true: c.primary }} />
          </Card>
        ) : null}

        {tool.needs.target && !(tool.needs.removeAll && removeAll) ? (
          <TextField
            label={t('create.target')}
            placeholder={t('create.targetPh')}
            value={target}
            onChangeText={setTarget}
            maxLength={120}
          />
        ) : null}

        {tool.needs.replacement ? (
          <TextField
            label={t('create.replacement')}
            placeholder={t('create.replacementPh')}
            value={replacement}
            onChangeText={setReplacement}
            maxLength={120}
          />
        ) : null}

        {tool.needs.reference ? (
          <View style={{ gap: Spacing.two }}>
            <AppText variant="smallBold" muted>
              {t('create.reference')}
            </AppText>
            {reference ? (
              <Pressable onPress={() => setReference(null)} accessibilityRole="button">
                <Image source={{ uri: reference.url }} style={styles.reference} contentFit="cover" />
              </Pressable>
            ) : (
              <Button
                label={t('create.referencePick')}
                icon="color-wand-outline"
                kind="secondary"
                loading={uploading === 'reference'}
                onPress={() => pick('library', 'reference')}
              />
            )}
          </View>
        ) : null}

        {tool.needs.instructions ? (
          <TextField
            label={t('create.instructions')}
            placeholder={t('create.instructionsPh')}
            value={instructions}
            onChangeText={setInstructions}
            multiline
            maxLength={300}
          />
        ) : null}

        <View style={{ gap: Spacing.two }}>
          <AppText variant="smallBold" muted>
            {t('create.variants')}
          </AppText>
          <View style={styles.wrap}>
            {([1, 2, 3, 4] as const).map((n) => (
              <Chip key={n} label={String(n)} selected={variants === n} onPress={() => setVariants(n)} />
            ))}
          </View>
        </View>
      </View>

      {error ? (
        <View style={{ marginTop: Spacing.three }}>
          <ErrorBanner message={error} />
        </View>
      ) : null}

      <Button
        label={t('create.generate')}
        icon="sparkles"
        size="lg"
        style={{ marginTop: Spacing.four }}
        disabled={!photo || uploading !== null}
        loading={generating}
        onPress={generate}
      />
      <AppText variant="small" muted style={{ textAlign: 'center', marginTop: Spacing.two }}>
        {t('create.cost', { n: cost })}
      </AppText>

      <GeneratingOverlay visible={generating} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toolIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', borderRadius: Radius.lg },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: { gap: Spacing.two, paddingRight: Spacing.three },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1 },
  styleWrap: { borderWidth: 2, borderRadius: Radius.lg + 2, padding: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  reference: { width: 120, height: 120, borderRadius: Radius.md },
});
