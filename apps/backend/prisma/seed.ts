// Seeds the style catalog and (once) a SUPER_ADMIN account with TOTP MFA and 10 recovery codes.
// Admin credentials are written to DATA_DIR/admin-credentials.txt (git-ignored, mode 600), never to stdout.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { STYLE_SEED } from '../src/catalog/catalog.data.js';
import { BACKUP_CODE_COUNT, hashBackupCode, hashPassword, newBackupCode, newTotpSecret, normalizeBackupCode, otpauthUri } from '../src/auth/crypto.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  for (const [i, s] of STYLE_SEED.entries()) {
    await prisma.style.upsert({ where: { id: s.id }, create: { ...s, sortOrder: i * 10 }, update: {} });
  }
  console.log(`styles: ${STYLE_SEED.length} ensured`);

  const email = (process.env.ADMIN_EMAIL ?? 'admin@airoom.local').toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`admin ${email} already exists — credentials unchanged`);
    return;
  }
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  const totpSecret = newTotpSecret();
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  const pepper = process.env.DEVICE_PEPPER!;
  await prisma.user.create({
    data: {
      email, emailVerifiedAt: new Date(), passwordHash: await hashPassword(password), name: 'AI Room Admin', role: 'SUPER_ADMIN', isGuest: false, totpSecret,
      backupCodes: { create: backupCodes.map((c) => ({ codeHash: hashBackupCode(pepper, normalizeBackupCode(c)!) })) },
    },
  });
  const dir = path.resolve(process.env.DATA_DIR ?? './data');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'admin-credentials.txt');
  await writeFile(
    file,
    `email=${email}\npassword=${password}\ntotp_secret=${totpSecret}\notpauth=${otpauthUri(totpSecret, email)}\nbackup_codes=${backupCodes.join(',')}\n`,
    { mode: 0o600 },
  );
  console.log(`admin ${email} created — credentials written to ${file}`);
  console.log('Add the otpauth URI to an authenticator app (or run `npm run admin:otp` in development).');
}

await main().finally(() => prisma.$disconnect());
