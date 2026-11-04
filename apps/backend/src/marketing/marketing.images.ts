import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadSample } from '../images/samples.js';

// Before/after images for social posts (API.md §7.18). Only our own photos: the sample living room (before) and
// the curated style photo made from it (after), which already carries the visible "made with AI" label. Users'
// photos are never used here (KVKK: that needs the owner's explicit consent first).

const STYLE_PHOTOS = fileURLToPath(new URL('../../assets/styles/', import.meta.url));

export const SOCIAL_FORMATS = {
  square: { width: 1080, height: 1080, label: 'Instagram gönderisi' },
  story: { width: 1080, height: 1920, label: 'Story / Reels / TikTok' },
  pin: { width: 1000, height: 1500, label: 'Pinterest' },
} as const;
export type SocialFormat = keyof typeof SOCIAL_FORMATS;
export const isSocialFormat = (v: unknown): v is SocialFormat => typeof v === 'string' && v in SOCIAL_FORMATS;

const styleFile = (id: string) => `${STYLE_PHOTOS}${id}.jpg`;
const SAFE_ID = /^[a-z_]{2,40}$/;

/** A style can be posted only if it has a curated photo (made from the sample room). */
export async function hasStylePhoto(id: string): Promise<boolean> {
  if (!SAFE_ID.test(id)) return false;
  return access(styleFile(id)).then(() => true, () => false);
}

const BRAND_BAR = 96;
const GAP = 6;

/**
 * Before on top, after below, a thin light gap between them and a brand bar at the bottom. Text is Latin only
 * ("casalume.app"): the server has no CJK fonts, and the caption carries the language.
 */
export async function renderBeforeAfter(styleId: string, format: SocialFormat): Promise<Buffer> {
  if (!SAFE_ID.test(styleId)) throw new Error('bad_style_id');
  const { width, height } = SOCIAL_FORMATS[format];
  const panel = Math.floor((height - BRAND_BAR - GAP) / 2);
  const [before, after] = await Promise.all([loadSample('living_room'), readFile(styleFile(styleId))]);
  // Both photos are cropped the same way, from the bottom up: the framing matches, and the after photo's
  // "made with AI" label (bottom right) always stays visible.
  const fit = (buf: Buffer) => sharp(buf).resize(width, panel, { fit: 'cover', position: 'south' }).jpeg({ quality: 90 }).toBuffer();
  const [top, bottom] = await Promise.all([fit(before), fit(after)]);
  const bar = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BRAND_BAR}">` +
      `<rect width="100%" height="100%" fill="#2B2420"/>` +
      `<text x="50%" y="58%" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Serif, Georgia, serif" font-size="40" letter-spacing="3" fill="#F6F1EA">casalume.app</text>` +
      `</svg>`,
  );
  return sharp({ create: { width, height, channels: 3, background: '#F6F1EA' } })
    .composite([
      { input: top, top: 0, left: 0 },
      { input: bottom, top: panel + GAP, left: 0 },
      { input: bar, top: height - BRAND_BAR, left: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
