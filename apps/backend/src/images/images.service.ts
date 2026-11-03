import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CONFIG, type Config } from '../config.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../common/infra.js';
import { safeEqual } from '../auth/crypto.js';
import type { Image, ImageKind } from '../generated/prisma/client.js';

// FIL-01 / FIL-02 / FIL-04: uploads are sniffed, decoded and re-encoded (strips EXIF/GPS — KVKK),
// stored outside any web root under a server UUID, and served only through short-lived signed URLs.

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (id: string) => UUID_RE.test(id);

export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(buf.toString('ascii', 8, 12))) {
    return 'image/heic';
  }
  return null;
}

export type ImageRef = { id: string; url: string; width: number; height: number };

@Injectable()
export class ImagesService implements OnModuleInit {
  private dir: string;
  private maxBytes: number;

  constructor(private prisma: PrismaService, @Inject(CONFIG) private cfg: Config) {
    this.dir = path.resolve(cfg.DATA_DIR, 'images');
    this.maxBytes = cfg.MAX_UPLOAD_MB * 1024 * 1024;
  }

  async onModuleInit() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  private file(id: string) {
    if (!isUuid(id)) throw new AppError(404, 'not_found', 'Görsel bulunamadı');
    return path.join(this.dir, `${id}.jpg`);
  }

  async normalize(buf: Buffer, declared: string, maxSide = 2048) {
    if (buf.length > this.maxBytes) throw new AppError(413, 'payload_too_large', `En fazla ${this.cfg.MAX_UPLOAD_MB} MB`);
    if (!(ALLOWED_MIME as readonly string[]).includes(declared)) {
      throw new AppError(415, 'unsupported_media_type', 'Yalnız JPEG, PNG, WEBP veya HEIC');
    }
    const sniffed = sniffMime(buf);
    const family = (m: string | null) => (m === 'image/heif' ? 'image/heic' : m);
    if (!sniffed) throw new AppError(415, 'unsupported_media_type', 'Dosya bir görsel değil');
    if (family(sniffed) !== family(declared)) throw new AppError(415, 'unsupported_media_type', 'Dosya türü uyuşmuyor');
    try {
      const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (info.width < 256 || info.height < 256) throw new AppError(400, 'bad_request', 'Görsel en az 256 piksel olmalı');
      return { buffer: data, width: info.width, height: info.height };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(415, 'unsupported_media_type', 'Görsel çözümlenemedi');
    }
  }

  async save(buffer: Buffer, meta: { ownerId: string; kind: ImageKind; designId?: string }): Promise<Image> {
    const { width, height } = await sharp(buffer).metadata();
    const id = randomUUID();
    await writeFile(this.file(id), buffer, { mode: 0o600 });
    return this.prisma.image.create({
      data: { id, ownerId: meta.ownerId, kind: meta.kind, designId: meta.designId, width, height, bytes: buffer.length },
    });
  }

  async read(id: string): Promise<Buffer> {
    try {
      return await readFile(this.file(id));
    } catch {
      throw new AppError(404, 'not_found', 'Görsel bulunamadı');
    }
  }

  /** AZ-01: an image can only be used as model input by its owner; others get a plain 404. */
  async owned(id: string, ownerId: string): Promise<Image> {
    if (!isUuid(id)) throw new AppError(404, 'not_found', 'Görsel bulunamadı');
    const img = await this.prisma.image.findFirst({ where: { id, ownerId } });
    if (!img) throw new AppError(404, 'not_found', 'Görsel bulunamadı');
    return img;
  }

  async remove(ids: string[]) {
    await Promise.all(ids.filter(isUuid).map((id) => rm(this.file(id), { force: true })));
  }

  private signature(id: string, exp: number) {
    return createHmac('sha256', this.cfg.IMAGE_URL_SECRET).update(`img:${id}:${exp}`).digest('base64url');
  }

  /** Expiry is rounded up to the hour so URLs stay stable (and cacheable) for a while. */
  url(id: string): string {
    const hour = 3600;
    const exp = Math.ceil(Date.now() / 1000 / hour) * hour + this.cfg.IMAGE_URL_TTL_HOURS * hour;
    return `${this.cfg.PUBLIC_BASE_URL}/v1/images/${id}?exp=${exp}&sig=${this.signature(id, exp)}`;
  }

  verifySignature(id: string, exp: string | undefined, sig: string | undefined): boolean {
    if (!isUuid(id) || !exp || !sig || !/^\d{10}$/.test(exp)) return false;
    if (Number(exp) < Date.now() / 1000) return false;
    return safeEqual(this.signature(id, Number(exp)), sig);
  }

  ref(img: Pick<Image, 'id' | 'width' | 'height'>): ImageRef {
    return { id: img.id, url: this.url(img.id), width: img.width, height: img.height };
  }

  /** Visible AI disclosure on free-plan results (Türkiye ad rules: "yapay zekâ ile oluşturulmuştur"). */
  async watermark(buffer: Buffer): Promise<Buffer> {
    const { width, height } = await sharp(buffer).metadata();
    const fs = Math.max(14, Math.round(height * 0.026));
    const label = 'AI Room · Yapay zekâ ile oluşturulmuştur';
    const w = Math.round(label.length * fs * 0.56) + fs * 2;
    const h = Math.round(fs * 2);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="100%" height="100%" rx="${h / 2}" fill="#000" fill-opacity="0.45"/>
        <text x="${fs}" y="${h * 0.68}" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="#fff">${label}</text>
      </svg>`,
    );
    return sharp(buffer)
      .composite([{ input: svg, left: Math.max(0, width - w - fs), top: Math.max(0, height - h - fs) }])
      .jpeg({ quality: 88 })
      .toBuffer();
  }
}
