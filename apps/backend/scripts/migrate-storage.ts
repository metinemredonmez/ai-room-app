// Copies images from the local disk store to the configured S3-compatible bucket (idempotent: skips
// objects that already exist). Usage: STORAGE_DRIVER=s3 S3_BUCKET=... npm run storage:migrate
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createObjectStore } from '../src/images/object-store.js';

const cfg = loadConfig();
if (cfg.STORAGE_DRIVER !== 's3') {
  console.error('Set STORAGE_DRIVER=s3 (and the S3_* variables) to migrate.');
  process.exit(1);
}
const dir = path.resolve(cfg.DATA_DIR, 'images');
const target = createObjectStore(cfg, dir);
const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^[0-9a-f-]{36}\.jpg$/.test(f));
let copied = 0;
let skipped = 0;
for (const f of files) {
  if (await target.get(f)) {
    skipped++;
    continue;
  }
  await target.put(f, await readFile(path.join(dir, f)), 'image/jpeg');
  copied++;
}
console.log(`storage migrate: ${copied} copied, ${skipped} already present, ${files.length} local files`);
