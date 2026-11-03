import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Built-in sample photos so the full flow can be tried without a camera: real rooms from Pexels
// (free for commercial use; credits in assets/samples/CREDITS.md), cropped to 1280×960, metadata
// stripped, the one visible licence plate blurred. Shipped with the backend, never downloaded at runtime.

export const SAMPLE_IDS = ['living_room', 'empty_room', 'bedroom', 'exterior', 'garden'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

/** Bump when the photos change, so cached style previews are rebuilt. */
export const SAMPLES_VERSION = 'photo-1';

// src/images → ../../assets and dist/images → ../../assets both resolve to apps/backend/assets.
const DIR = fileURLToPath(new URL('../../assets/samples/', import.meta.url));
const cache = new Map<SampleId, Buffer>();

export async function loadSample(id: SampleId): Promise<Buffer> {
  let buf = cache.get(id);
  if (!buf) {
    buf = await readFile(`${DIR}${id}.jpg`);
    cache.set(id, buf);
  }
  return buf;
}
