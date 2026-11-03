// Development helper: prints the current admin TOTP code from DATA_DIR/admin-credentials.txt.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { currentStep, totpAt } from '../src/auth/crypto.js';

if (process.env.NODE_ENV === 'production') {
  console.error('admin:otp is a development helper and is disabled in production');
  process.exit(1);
}
const file = path.resolve(process.env.DATA_DIR ?? './data', 'admin-credentials.txt');
const secret = (await readFile(file, 'utf8')).match(/^totp_secret=(\w+)$/m)?.[1];
if (!secret) throw new Error(`no totp_secret in ${file}`);
const step = currentStep();
console.log(totpAt(secret, step), `(valid ~${30 - Math.floor((Date.now() / 1000) % 30)}s)`);
