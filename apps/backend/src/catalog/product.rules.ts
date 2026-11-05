import { z } from 'zod';
import { COLORS, FLOORS, ROOMS, TOOLS, TOOL_IDS, type Locale } from './catalog.data.js';
import { localize } from './catalog.i18n.js';

// Product catalog from the admin (API.md §7.25; YediOda #95 "her şey panelden", fal-app/maeyja catalog pattern).
// The code says what a tool does (its inputs and its prompt); the panel says whether it is offered, to whom (PRO),
// how it is named, in which order, and which rooms, floors and colours the app offers with which prompt text.
// Until someone saves it the catalog is the code's, so behaviour is unchanged. Texts are Turkish and English; the
// other nine languages keep their translation while the English name is the code's, else they show the English name.

export const MAX_ROOMS = 40;
export const MAX_FLOORS = 30;
export const MAX_COLORS = 30;
const MAX_RETIRED = 200;

/** Icons the app can draw for a room (Ionicons names used by the mobile app; the web ignores them). */
export const ROOM_ICONS = [
  'tv-outline', 'cafe-outline', 'bed-outline', 'restaurant-outline', 'water-outline', 'wine-outline', 'happy-outline',
  'laptop-outline', 'enter-outline', 'sunny-outline', 'cube-outline', 'briefcase-outline', 'home-outline',
  'storefront-outline', 'business-outline', 'library-outline', 'shirt-outline', 'fitness-outline',
  'game-controller-outline', 'musical-notes-outline', 'car-outline', 'flower-outline', 'leaf-outline',
  'construct-outline', 'medkit-outline', 'school-outline', 'book-outline', 'basket-outline',
] as const;

const id = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const name = z.string().trim().min(1).max(40);
const description = z.string().trim().min(1).max(120);
/** Prompt words go to the image model inside a fixed English template: short English, no quotes or brackets. */
const prompt = (max: number) =>
  z.string().trim().min(2).max(max).regex(/^[A-Za-z0-9 ,'()/&.-]+$/, 'prompt_charset');

/** Credits one image of the tool costs (API.md §7.25.1): a design costs variants × credits; daily free uses count the same way. */
export const MAX_TOOL_CREDITS = 10;
const ToolSchema = z
  .object({
    id: z.enum(TOOL_IDS), enabled: z.boolean(), isPro: z.boolean(), isNew: z.boolean(), credits: z.number().int().min(1).max(MAX_TOOL_CREDITS),
    nameTr: name, nameEn: name, descriptionTr: description, descriptionEn: description,
  })
  .strict();
const RoomSchema = z
  .object({ id, nameTr: name, nameEn: name, prompt: prompt(60), icon: z.enum(ROOM_ICONS), enabled: z.boolean() })
  .strict();
const FloorSchema = z.object({ id, nameTr: name, nameEn: name, prompt: prompt(80), enabled: z.boolean() }).strict();
const ColorSchema = z
  .object({ id, nameTr: name, nameEn: name, hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((h) => h.toUpperCase()), enabled: z.boolean() })
  .strict();

/** What the admin edits. Array order is the order the app shows. */
export const ProductInputSchema = z
  .object({
    tools: z.array(ToolSchema).length(TOOL_IDS.length),
    rooms: z.array(RoomSchema).max(MAX_ROOMS),
    floors: z.array(FloorSchema).max(MAX_FLOORS),
    colors: z.array(ColorSchema).max(MAX_COLORS),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const unique = (list: Array<{ id: string }>, at: string) => {
      const seen = new Set<string>();
      list.forEach((x, i) => {
        if (seen.has(x.id)) issue([at, i, 'id'], 'duplicate_id');
        seen.add(x.id);
      });
    };
    unique(c.tools, 'tools');
    unique(c.rooms, 'rooms');
    unique(c.floors, 'floors');
    unique(c.colors, 'colors');
    if (!c.tools.some((t) => t.enabled)) issue(['tools'], 'one_tool_enabled');
    const needsRoom = c.tools.some((t) => t.enabled && TOOLS[t.id].needs.room);
    if (needsRoom && !c.rooms.some((r) => r.enabled)) issue(['rooms'], 'one_room_enabled');
    if (c.tools.some((t) => t.enabled && t.id === 'flooring') && !c.floors.some((f) => f.enabled)) issue(['floors'], 'one_floor_enabled');
  });
export type ProductInput = z.infer<typeof ProductInputSchema>;
export type ToolEntry = z.infer<typeof ToolSchema>;
export type RoomEntry = z.infer<typeof RoomSchema>;
export type FloorEntry = z.infer<typeof FloorSchema>;
type Retired = { id: string; nameTr: string; nameEn: string; prompt: string };

/**
 * Stored form: the input plus rooms and floors taken off the list. Old designs keep their room name in titles and a
 * queued job still gets its prompt, so a removal never breaks history (the same idea as retired credit packs).
 */
export type StoredProduct = ProductInput & { retired: { rooms: Retired[]; floors: Retired[] } };

export function defaultProduct(): StoredProduct {
  return {
    tools: TOOL_IDS.map((tid) => {
      const t = TOOLS[tid];
      return { id: tid, enabled: true, isPro: t.isPro, isNew: t.isNew, credits: 1, nameTr: t.name.tr, nameEn: t.name.en, descriptionTr: t.description.tr, descriptionEn: t.description.en };
    }),
    rooms: Object.entries(ROOMS).map(([rid, r]) => ({ id: rid, nameTr: r.name.tr, nameEn: r.name.en, prompt: r.prompt, icon: r.icon as RoomEntry['icon'], enabled: true })),
    floors: Object.entries(FLOORS).map(([fid, f]) => ({ id: fid, nameTr: f.name.tr, nameEn: f.name.en, prompt: f.prompt, enabled: true })),
    colors: COLORS.map((c) => ({ id: c.id, nameTr: c.name.tr, nameEn: c.name.en, hex: c.hex.toUpperCase(), enabled: true })),
    retired: { rooms: [], floors: [] },
  };
}

const RetiredSchema = z.object({ id, nameTr: name, nameEn: name, prompt: z.string().max(80) }).strict();

/**
 * Reads the stored row. A tool the code added since the last save is appended as the code defines it and a tool the
 * code dropped is ignored, so a deploy never needs a panel save. A corrupt row falls back to the code's catalog.
 */
export function parseStoredProduct(value: unknown, defaults: StoredProduct): { catalog: StoredProduct; ok: boolean } {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  // A catalog saved before tools had a price costs 1 credit per image, as it did then.
  const tools = Array.isArray(v.tools)
    ? v.tools
        .filter((t) => (TOOL_IDS as readonly string[]).includes((t as { id?: string })?.id ?? ''))
        .map((t) => (t && typeof t === 'object' && !('credits' in t) ? { ...t, credits: 1 } : t))
    : [];
  const known = new Set(tools.map((t) => (t as { id: string }).id));
  const merged = { tools: [...tools, ...defaults.tools.filter((t) => !known.has(t.id))], rooms: v.rooms, floors: v.floors, colors: v.colors };
  const parsed = ProductInputSchema.safeParse(merged);
  const retired = z.object({ rooms: z.array(RetiredSchema).max(MAX_RETIRED), floors: z.array(RetiredSchema).max(MAX_RETIRED) }).safeParse(v.retired);
  if (!parsed.success) return { catalog: defaults, ok: false };
  return { catalog: { ...parsed.data, retired: retired.success ? retired.data : { rooms: [], floors: [] } }, ok: true };
}

/** Rooms and floors that leave the list move to `retired`; one put back leaves it. */
export function nextProduct(prev: StoredProduct, input: ProductInput): StoredProduct {
  const retire = <T extends Retired>(before: T[], now: Array<{ id: string }>, old: Retired[]): Retired[] => {
    const live = new Set(now.map((x) => x.id));
    const dropped = before.filter((x) => !live.has(x.id)).map(({ id: rid, nameTr, nameEn, prompt: p }) => ({ id: rid, nameTr, nameEn, prompt: p }));
    return [...dropped, ...old.filter((r) => !live.has(r.id) && !dropped.some((d) => d.id === r.id))].slice(0, MAX_RETIRED);
  };
  return {
    ...input,
    retired: { rooms: retire(prev.rooms, input.rooms, prev.retired.rooms), floors: retire(prev.floors, input.floors, prev.retired.floors) },
  };
}

/** Short, readable change list for the audit log (LOG-01): what was switched, renamed, added or removed. */
export function productDiff(prev: StoredProduct, next: ProductInput): string[] {
  const out: string[] = [];
  const toolFields = ['enabled', 'isPro', 'isNew', 'credits', 'nameTr', 'nameEn', 'descriptionTr', 'descriptionEn'] as const;
  for (const t of next.tools) {
    const before = prev.tools.find((x) => x.id === t.id);
    for (const f of toolFields) if (before && before[f] !== t[f]) out.push(`tools.${t.id}.${f}: ${String(before[f])} → ${String(t[f])}`);
  }
  if (prev.tools.map((t) => t.id).join() !== next.tools.map((t) => t.id).join()) out.push('tools: sıra değişti');
  const lists = [
    ['rooms', prev.rooms, next.rooms, ['nameTr', 'nameEn', 'prompt', 'icon', 'enabled']],
    ['floors', prev.floors, next.floors, ['nameTr', 'nameEn', 'prompt', 'enabled']],
    ['colors', prev.colors, next.colors, ['nameTr', 'nameEn', 'hex', 'enabled']],
  ] as const;
  for (const [key, before, after, fields] of lists) {
    const b = new Map<string, Record<string, unknown>>(before.map((x) => [x.id, x as Record<string, unknown>]));
    const a = new Set(after.map((x) => x.id));
    for (const x of after as ReadonlyArray<Record<string, unknown> & { id: string }>) {
      const old = b.get(x.id);
      if (!old) out.push(`${key}+ ${x.id}`);
      else for (const f of fields) if (old[f] !== x[f]) out.push(`${key}.${x.id}.${f}: ${String(old[f])} → ${String(x[f])}`);
    }
    for (const x of before) if (!a.has(x.id)) out.push(`${key}- ${x.id}`);
    const order = (l: ReadonlyArray<{ id: string }>) => l.map((x) => x.id).filter((i) => a.has(i) && b.has(i)).join();
    if (order(before) !== order(after)) out.push(`${key}: sıra değişti`);
  }
  return out.length > 40 ? [...out.slice(0, 40), `… ve ${out.length - 40} değişiklik daha`] : out;
}

/**
 * A name in the user's language. Turkish and English are the panel's; the other languages use the translation file
 * while the English name is still the code's (a renamed or added entry would otherwise show a stale translation).
 */
export function nameIn(locale: Locale, key: string, current: { tr: string; en: string }, codeEn: string | undefined): string {
  if (locale === 'tr' || locale === 'en') return current[locale];
  return codeEn !== undefined && codeEn === current.en ? localize(locale, key, current) : current.en;
}

const CODE_ROOM_EN = new Map(Object.entries(ROOMS).map(([k, r]) => [k, r.name.en]));
const CODE_FLOOR_EN = new Map(Object.entries(FLOORS).map(([k, f]) => [k, f.name.en]));
const CODE_COLOR_EN = new Map(COLORS.map((c) => [c.id, c.name.en]));

export function toolName(t: ToolEntry, locale: Locale) {
  return nameIn(locale, `tools.${t.id}.name`, { tr: t.nameTr, en: t.nameEn }, TOOLS[t.id].name.en);
}

/** What `/v1/catalog` serves: offered entries only, in the panel's order. */
export function publicProduct(c: StoredProduct, locale: Locale) {
  return {
    tools: c.tools
      .filter((t) => t.enabled)
      .map((t) => {
        const code = TOOLS[t.id];
        const description = nameIn(locale, `tools.${t.id}.description`, { tr: t.descriptionTr, en: t.descriptionEn }, code.description.en);
        return { id: t.id, name: toolName(t, locale), description, icon: code.icon, category: code.category, isPro: t.isPro, isNew: t.isNew, credits: t.credits, needs: code.needs };
      }),
    rooms: c.rooms.filter((r) => r.enabled).map((r) => ({ id: r.id, name: nameIn(locale, `rooms.${r.id}.name`, { tr: r.nameTr, en: r.nameEn }, CODE_ROOM_EN.get(r.id)), icon: r.icon })),
    floors: c.floors.filter((f) => f.enabled).map((f) => ({ id: f.id, name: nameIn(locale, `floors.${f.id}.name`, { tr: f.nameTr, en: f.nameEn }, CODE_FLOOR_EN.get(f.id)) })),
    colors: c.colors.filter((x) => x.enabled).map((x) => ({ id: x.id, name: nameIn(locale, `colors.${x.id}.name`, { tr: x.nameTr, en: x.nameEn }, CODE_COLOR_EN.get(x.id)), hex: x.hex })),
  };
}

/** A room for titles and prompts: listed (on or off) or retired; undefined for an unknown id. */
export function findRoom(c: StoredProduct, rid: string | null | undefined) {
  if (!rid) return undefined;
  return c.rooms.find((r) => r.id === rid) ?? c.retired.rooms.find((r) => r.id === rid);
}

export function findFloor(c: StoredProduct, fid: string | null | undefined) {
  if (!fid) return undefined;
  return c.floors.find((f) => f.id === fid) ?? c.retired.floors.find((f) => f.id === fid);
}

export function roomName(c: StoredProduct, rid: string | null | undefined, locale: Locale): string | undefined {
  const r = findRoom(c, rid);
  return r ? nameIn(locale, `rooms.${r.id}.name`, { tr: r.nameTr, en: r.nameEn }, CODE_ROOM_EN.get(r.id)) : undefined;
}

export function findTool(c: StoredProduct, tid: string): ToolEntry | undefined {
  return c.tools.find((t) => t.id === tid);
}
