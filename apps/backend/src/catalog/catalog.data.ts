// Static catalog: tools, rooms, floors, colours and plans. Styles live in the database (admin-managed).

/** Web and app languages (API.md §7.17). Content is written in Turkish and English; the other languages come from
 * assets/i18n/catalog/<locale>.json (scripts/i18n_fill.py) and fall back to English. */
export const LOCALES = ['tr', 'en', 'de', 'es', 'fr', 'it', 'ru', 'nl', 'ja', 'ko', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
/** The language texts written in code or the admin are in: Turkish for Turkish, English for everyone else. */
export type ContentLocale = 'tr' | 'en';
export const contentLocale = (l: string | null | undefined): ContentLocale => (l === 'tr' ? 'tr' : 'en');
type L = { tr: string; en: string };

export const TOOL_IDS = [
  'redesign', 'furnish', 'declutter', 'replace', 'paint', 'flooring', 'exterior', 'garden', 'reference', 'custom',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

type Needs = {
  style: boolean; room: boolean; floor: boolean; color: boolean; target: boolean;
  replacement: boolean; instructions: boolean; reference: boolean; removeAll: boolean;
  /** Tap selection (API.md §7.15): the user taps the objects to change instead of naming them. */
  points: boolean;
};
const needs = (n: Partial<Needs>): Needs => ({
  style: false, room: false, floor: false, color: false, target: false,
  replacement: false, instructions: false, reference: false, removeAll: false, points: false, ...n,
});

export const TOOLS: Record<ToolId, {
  name: L; description: L; icon: string; category: 'interior' | 'exterior' | 'edit';
  isPro: boolean; isNew: boolean; needs: Needs;
}> = {
  redesign: {
    name: { tr: 'Anında Yenile', en: 'Instant Remodel' },
    description: { tr: 'Odanı seçtiğin stilde baştan tasarla', en: 'Restyle your room in any style' },
    icon: 'color-wand-outline', category: 'interior', isPro: false, isNew: false,
    needs: needs({ style: true, room: true, instructions: true }),
  },
  furnish: {
    name: { tr: 'Boş Odayı Döşe', en: 'Furnish Empty Room' },
    description: { tr: 'Boş daireyi sanal olarak döşe', en: 'Virtually stage an empty room' },
    icon: 'bed-outline', category: 'interior', isPro: false, isNew: false,
    needs: needs({ style: true, room: true, instructions: true }),
  },
  declutter: {
    name: { tr: 'Nesne Sil', en: 'Remove Objects' },
    description: { tr: 'Dağınıklığı ya da tüm eşyaları kaldır', en: 'Remove clutter or empty the room' },
    icon: 'trash-outline', category: 'edit', isPro: false, isNew: false,
    needs: needs({ room: true, target: true, removeAll: true, points: true }),
  },
  replace: {
    name: { tr: 'Değiştir', en: 'Replace' },
    description: { tr: 'Bir eşyayı başka bir şeyle değiştir', en: 'Swap one item for another' },
    icon: 'swap-horizontal-outline', category: 'edit', isPro: false, isNew: false,
    needs: needs({ room: true, target: true, replacement: true, points: true }),
  },
  paint: {
    name: { tr: 'Duvar Boyası', en: 'Wall Paint' },
    description: { tr: 'Duvarları istediğin renge boya', en: 'Repaint your walls' },
    icon: 'color-palette-outline', category: 'edit', isPro: false, isNew: false,
    needs: needs({ room: true, color: true, points: true }),
  },
  flooring: {
    name: { tr: 'Yeni Zemin', en: 'New Flooring' },
    description: { tr: 'Parke, mermer, seramik dene', en: 'Try parquet, marble or tiles' },
    icon: 'grid-outline', category: 'edit', isPro: false, isNew: false,
    needs: needs({ room: true, floor: true }),
  },
  exterior: {
    name: { tr: 'Dış Cephe', en: 'Exterior' },
    description: { tr: 'Evinin cephesini yenile', en: "Refresh your home's facade" },
    icon: 'home-outline', category: 'exterior', isPro: false, isNew: false,
    needs: needs({ style: true, instructions: true }),
  },
  garden: {
    name: { tr: 'Bahçe & Teras', en: 'Garden & Terrace' },
    description: { tr: 'Bahçeni ya da terasını düzenle', en: 'Landscape your garden or terrace' },
    icon: 'leaf-outline', category: 'exterior', isPro: false, isNew: false,
    needs: needs({ style: true, instructions: true }),
  },
  reference: {
    name: { tr: 'Referans Stil', en: 'Reference Style' },
    description: { tr: 'Beğendiğin bir fotoğrafın stilini uygula', en: 'Copy the style of a photo you love' },
    icon: 'images-outline', category: 'interior', isPro: true, isNew: true,
    needs: needs({ room: true, reference: true, instructions: true }),
  },
  custom: {
    name: { tr: 'Kendi Tarifin', en: 'Custom Prompt' },
    description: { tr: 'Ne istediğini yaz, yapay zekâ uygulasın', en: 'Describe the change in your words' },
    icon: 'create-outline', category: 'edit', isPro: true, isNew: true,
    needs: needs({ room: true, instructions: true }),
  },
};

export const ROOMS: Record<string, { name: L; prompt: string; icon: string }> = {
  living_room: { name: { tr: 'Oturma Odası', en: 'Living Room' }, prompt: 'living room', icon: 'tv-outline' },
  salon: { name: { tr: 'Salon (Misafir)', en: 'Formal Lounge' }, prompt: 'formal guest lounge', icon: 'cafe-outline' },
  bedroom: { name: { tr: 'Yatak Odası', en: 'Bedroom' }, prompt: 'bedroom', icon: 'bed-outline' },
  kitchen: { name: { tr: 'Mutfak', en: 'Kitchen' }, prompt: 'kitchen', icon: 'restaurant-outline' },
  bathroom: { name: { tr: 'Banyo', en: 'Bathroom' }, prompt: 'bathroom', icon: 'water-outline' },
  dining_room: { name: { tr: 'Yemek Odası', en: 'Dining Room' }, prompt: 'dining room', icon: 'wine-outline' },
  kids_room: { name: { tr: 'Çocuk Odası', en: "Kids' Room" }, prompt: "children's room", icon: 'happy-outline' },
  home_office: { name: { tr: 'Çalışma Odası', en: 'Home Office' }, prompt: 'home office', icon: 'laptop-outline' },
  hallway: { name: { tr: 'Antre', en: 'Hallway' }, prompt: 'entrance hallway', icon: 'enter-outline' },
  balcony: { name: { tr: 'Balkon', en: 'Balcony' }, prompt: 'apartment balcony', icon: 'sunny-outline' },
  studio: { name: { tr: 'Stüdyo Daire', en: 'Studio Flat' }, prompt: 'studio apartment', icon: 'cube-outline' },
  office: { name: { tr: 'Ofis', en: 'Office' }, prompt: 'office', icon: 'briefcase-outline' },
};

export const FLOORS: Record<string, { name: L; prompt: string }> = {
  oak_parquet: { name: { tr: 'Meşe Parke', en: 'Oak Parquet' }, prompt: 'natural oak plank parquet' },
  herringbone: { name: { tr: 'Balıksırtı Parke', en: 'Herringbone' }, prompt: 'herringbone oak parquet' },
  marble: { name: { tr: 'Beyaz Mermer', en: 'White Marble' }, prompt: 'polished white marble tiles' },
  travertine: { name: { tr: 'Traverten', en: 'Travertine' }, prompt: 'honed travertine stone tiles' },
  concrete: { name: { tr: 'Cilalı Beton', en: 'Polished Concrete' }, prompt: 'smooth polished concrete' },
  terracotta: { name: { tr: 'Terrakota', en: 'Terracotta' }, prompt: 'handmade terracotta tiles' },
  ceramic: { name: { tr: 'Mat Seramik', en: 'Matte Ceramic' }, prompt: 'large-format matte ceramic tiles' },
  carpet: { name: { tr: 'Halıfleks', en: 'Carpet' }, prompt: 'soft neutral wall-to-wall carpet' },
};

export const COLORS: Array<{ id: string; name: L; hex: string }> = [
  { id: 'kirik_beyaz', name: { tr: 'Kırık Beyaz', en: 'Off-White' }, hex: '#F2EDE4' },
  { id: 'kum_beji', name: { tr: 'Kum Beji', en: 'Sand Beige' }, hex: '#D9C7A7' },
  { id: 'adacayi', name: { tr: 'Adaçayı Yeşili', en: 'Sage Green' }, hex: '#9CAF88' },
  { id: 'zeytin', name: { tr: 'Zeytin', en: 'Olive' }, hex: '#6B7046' },
  { id: 'ege_mavisi', name: { tr: 'Ege Mavisi', en: 'Aegean Blue' }, hex: '#3E6E9E' },
  { id: 'gece_mavisi', name: { tr: 'Gece Mavisi', en: 'Midnight Blue' }, hex: '#1F2A44' },
  { id: 'terrakota', name: { tr: 'Terrakota', en: 'Terracotta' }, hex: '#C46A47' },
  { id: 'gul_kurusu', name: { tr: 'Gül Kurusu', en: 'Dusty Rose' }, hex: '#C9A1A0' },
  { id: 'hardal', name: { tr: 'Hardal', en: 'Mustard' }, hex: '#C99A2E' },
  { id: 'antrasit', name: { tr: 'Antrasit', en: 'Anthracite' }, hex: '#3A3D40' },
];

// storeProductId = App Store / Play product id (RevenueCat package). Store prices win in the app;
// priceTRY is the list price shown on the web and as a fallback.
export const PLANS: Array<{ id: string; name: L; period: 'week' | 'month' | 'year'; priceTRY: number; badge: L | null; storeProductId: string }> = [
  { id: 'pro_weekly', name: { tr: 'Haftalık', en: 'Weekly' }, period: 'week', priceTRY: 149.99, badge: null, storeProductId: 'casalume_pro_weekly' },
  { id: 'pro_monthly', name: { tr: 'Aylık', en: 'Monthly' }, period: 'month', priceTRY: 349.99, badge: { tr: 'POPÜLER', en: 'POPULAR' }, storeProductId: 'casalume_pro_monthly' },
  { id: 'pro_yearly', name: { tr: 'Yıllık', en: 'Yearly' }, period: 'year', priceTRY: 1299.99, badge: { tr: 'EN AVANTAJLI', en: 'BEST VALUE' }, storeProductId: 'casalume_pro_yearly' },
];

/** Seed data for the admin-managed Style table. */
export const STYLE_SEED: Array<{
  id: string; nameTr: string; nameEn: string; descriptionTr: string; descriptionEn: string;
  prompt: string; palette: string[]; isPro: boolean;
}> = [
  { id: 'modern', nameTr: 'Modern', nameEn: 'Modern', descriptionTr: 'Temiz çizgiler, nötr tonlar, sıcak ahşap', descriptionEn: 'Clean lines, neutral tones, warm wood', prompt: 'modern interior: clean lines, neutral palette with warm wood accents, slim-profile furniture, layered lighting', palette: ['#E8E2D8', '#B9A58C', '#5E5A55', '#2B2B2B'], isPro: false },
  { id: 'modern_turkish', nameTr: 'Modern Türk', nameEn: 'Modern Turkish', descriptionTr: 'Traverten, ceviz, kilim ve bakır dokunuşlar', descriptionEn: 'Travertine, walnut, kilim and copper', prompt: 'contemporary Turkish interior: travertine and walnut, hand-woven kilim and Anatolian textiles, copper accents, modern sofa, warm minimal', palette: ['#E9DCC9', '#A86B45', '#6E4B3A', '#2F5D62'], isPro: false },
  { id: 'japandi', nameTr: 'Japandi', nameEn: 'Japandi', descriptionTr: 'Alçak ahşap mobilya, toprak tonları, sadelik', descriptionEn: 'Low wood furniture, earthy calm', prompt: 'Japandi interior: low natural-wood furniture, muted earth tones, paper lamps, wabi-sabi ceramics, uncluttered', palette: ['#EDE6DA', '#C4B49A', '#8A7A63', '#3F3A34'], isPro: false },
  { id: 'scandinavian', nameTr: 'İskandinav', nameEn: 'Scandinavian', descriptionTr: 'Açık meşe, beyaz duvarlar, yün ve keten', descriptionEn: 'Light oak, white walls, wool and linen', prompt: 'Scandinavian interior: light oak, white walls, wool and linen textiles, cozy hygge lighting, plants', palette: ['#F5F3EF', '#E3D5BE', '#A9B4A0', '#4A4A48'], isPro: false },
  { id: 'aegean', nameTr: 'Ege', nameEn: 'Aegean', descriptionTr: 'Badana beyazı, Ege mavisi, zeytin ahşabı', descriptionEn: 'Whitewash, Aegean blue, olive wood', prompt: 'Aegean coastal interior: whitewashed walls, cobalt blue accents, olive wood, linen, terracotta pots, sunlit and breezy', palette: ['#F7F5F0', '#3E6E9E', '#C46A47', '#8C8A5A'], isPro: false },
  { id: 'minimalist', nameTr: 'Minimalist', nameEn: 'Minimalist', descriptionTr: 'Az ama öz, ferah ve sakin', descriptionEn: 'Few pieces, airy and calm', prompt: 'minimalist interior: very few carefully chosen pieces, white and soft grey palette, hidden storage, calm and airy', palette: ['#FAFAF8', '#E5E4E0', '#B8B6B0', '#3C3C3A'], isPro: false },
  { id: 'mediterranean', nameTr: 'Akdeniz', nameEn: 'Mediterranean', descriptionTr: 'Kemerler, kireç sıva, terrakota', descriptionEn: 'Arches, lime plaster, terracotta', prompt: 'Mediterranean interior: arched details, lime-plaster walls, terracotta floor, wrought iron, warm sand tones', palette: ['#F1E6D2', '#D9A066', '#B5654A', '#5B4636'], isPro: false },
  { id: 'industrial', nameTr: 'Endüstriyel', nameEn: 'Industrial', descriptionTr: 'Tuğla, beton, siyah metal, deri', descriptionEn: 'Brick, concrete, black steel, leather', prompt: 'industrial loft interior: exposed brick or concrete, black steel, leather, Edison bulbs, reclaimed wood', palette: ['#BDB5AA', '#8B5E3C', '#4A4642', '#1E1E1E'], isPro: false },
  { id: 'bohemian', nameTr: 'Bohem', nameEn: 'Bohemian', descriptionTr: 'Rattan, katmanlı halılar, bol bitki', descriptionEn: 'Rattan, layered rugs, plants', prompt: 'bohemian interior: layered rugs, rattan, macrame, many plants, warm terracotta and mustard tones, eclectic decor', palette: ['#EBD9C1', '#D08A4F', '#C99A2E', '#4F6B47'], isPro: false },
  { id: 'rustic', nameTr: 'Rustik Köy Evi', nameEn: 'Rustic Farmhouse', descriptionTr: 'Ahşap kirişler, doğal taş, sıcak ışık', descriptionEn: 'Wood beams, stone, warm light', prompt: 'rustic Anatolian farmhouse interior: wooden beams, natural stone, vintage furniture, hand-woven textiles, cozy warm light', palette: ['#E4D5BF', '#8D6748', '#6B5B4B', '#3B2F27'], isPro: false },
  { id: 'coastal', nameTr: 'Yazlık / Sahil', nameEn: 'Coastal', descriptionTr: 'Kum ve gök mavisi, rattan, çizgili dokular', descriptionEn: 'Sand and sky blue, rattan, stripes', prompt: 'coastal summer-house interior: sand and sky-blue palette, light woods, rattan, striped textiles, relaxed beach-house feel', palette: ['#F4EEE2', '#7FB3C8', '#D7C3A0', '#36556B'], isPro: false },
  { id: 'classic_ottoman', nameTr: 'Osmanlı Klasik', nameEn: 'Ottoman Classic', descriptionTr: 'Oymalı ceviz, sedir, İznik çini, pirinç fener', descriptionEn: 'Carved walnut, sedir, Iznik tiles', prompt: 'Ottoman-inspired classic interior: carved walnut, low sedir seating with cushions, kilim rugs, Iznik tile accents, brass lanterns, deep jewel tones', palette: ['#8C2F39', '#1F4E79', '#C9A227', '#3B2A20'], isPro: true },
  { id: 'cappadocia', nameTr: 'Kapadokya Taş Ev', nameEn: 'Cappadocia Cave House', descriptionTr: 'Taş kemerler, nişler, toprak tonları', descriptionEn: 'Stone arches, niches, earth tones', prompt: 'Cappadocia cave-house interior: carved stone arches and niches, warm earth tones, handmade rugs, ambient warm light', palette: ['#E3CBAA', '#C47A4A', '#8E5B3E', '#4A3426'], isPro: true },
  { id: 'mid_century', nameTr: 'Mid-Century', nameEn: 'Mid-Century', descriptionTr: 'Ceviz, konik ayaklar, hardal ve petrol', descriptionEn: 'Walnut, tapered legs, mustard and teal', prompt: 'mid-century modern interior: walnut furniture with tapered legs, mustard and teal accents, sculptural lamps', palette: ['#EADBC4', '#C99A3B', '#2E6E6A', '#5A3E2B'], isPro: true },
  { id: 'art_deco', nameTr: 'Art Deco Lüks', nameEn: 'Art Deco Luxe', descriptionTr: 'Kadife, pirinç, mermer, zümrüt ve altın', descriptionEn: 'Velvet, brass, marble, emerald and gold', prompt: 'Art Deco luxury interior: velvet, brass, marble, geometric patterns, emerald and gold palette, statement chandelier', palette: ['#1F6F5C', '#C9A227', '#F0EBE3', '#1A1A1A'], isPro: true },
];

export const pick = (l: L, locale: Locale) => l[contentLocale(locale)];
