// Casalume brand icons: one SVG source → every SVG/PNG the apps ship.
// Usage (repo root): node scripts/brand-icons.mjs
// The mark: an arched doorway with light falling through it and a spark ("lume") above.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('apps/backend/package.json'));
const sharp = require('sharp');

const KIL = {
  ink: '#1c1714', // dark background
  linen: '#f6f1ea', // light background
  cream: '#f3ece2',
  terracotta: '#c9673e',
  terracottaDeep: '#a9532e', // on light backgrounds (contrast)
  terracottaLight: '#e07a52', // on dark backgrounds
};

// Geometry (1024 grid). apps/admin/src/components/brand-mark.tsx repeats these paths; change both together.
export const PATHS = {
  inside: 'M402 744V452a110 110 0 0 1 220 0v292z', // light inside the doorway
  beam: 'M402 744h220l100 124H302z', // light spilling onto the floor
  arch: 'M372 744V452a140 140 0 0 1 280 0v292',
  spark: 'M730 198q15 77 92 92q-77 15-92 92q-15-77-92-92q77-15 92-92z',
};
const NUDGE = 'translate(-25 -14)'; // optical centre of arch + spark

/** The mark alone, centred; `scale` shrinks it for adaptive/splash safe zones. */
function mark({ arch, light, insideOpacity, beamOpacity, spark }, scale = 1) {
  const t = 512 - 512 * scale;
  return `<g transform="translate(${t} ${t}) scale(${scale}) ${NUDGE}">
    <path d="${PATHS.inside}" fill="${light}" fill-opacity="${insideOpacity}"/>
    <path d="${PATHS.beam}" fill="${light}" fill-opacity="${beamOpacity}"/>
    <path d="${PATHS.arch}" fill="none" stroke="${arch}" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${PATHS.spark}" fill="${spark}"/>
  </g>`;
}

const DARK = { arch: KIL.terracottaLight, light: KIL.terracottaLight, insideOpacity: 0.2, beamOpacity: 0.4, spark: KIL.cream };
const LIGHT = { arch: KIL.terracottaDeep, light: KIL.terracotta, insideOpacity: 0.14, beamOpacity: 0.3, spark: KIL.terracotta };
const MONO = { arch: '#ffffff', light: '#ffffff', insideOpacity: 0.35, beamOpacity: 0.55, spark: '#ffffff' };

const svg = (body, { bg, radius = 0 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${
    bg ? `<rect width="1024" height="1024" rx="${radius}" fill="${bg}"/>` : ''
  }${body}</svg>\n`;

// Store icons must be full-bleed squares (the OS rounds them); the rounded ones are for web/docs.
const files = {
  'casalume-ikon-koyu.svg': svg(mark(DARK), { bg: KIL.ink }),
  'casalume-ikon-acik.svg': svg(mark(LIGHT), { bg: KIL.linen }),
  'casalume-ikon-koyu-yuvarlak.svg': svg(mark(DARK), { bg: KIL.ink, radius: 228 }),
  'casalume-ikon-acik-yuvarlak.svg': svg(mark(LIGHT), { bg: KIL.linen, radius: 228 }),
  'casalume-isaret.svg': svg(mark(DARK)),
  'casalume-logo-animasyonlu-koyu.svg': animated(DARK, { bg: KIL.ink, radius: 228 }),
  'casalume-logo-animasyonlu-acik.svg': animated(LIGHT, { bg: KIL.linen, radius: 228 }),
};

/** Animated logo: the arch draws itself, light spills out, the spark pops and then twinkles. */
function animated({ arch, light, insideOpacity, beamOpacity, spark }, bg) {
  const css = `
    .arch{stroke-dasharray:1;animation:draw .9s cubic-bezier(.65,0,.35,1) both}
    .in{animation:fade .6s .7s ease-out both}
    .beam{transform-box:fill-box;transform-origin:50% 0;animation:spill .7s .8s cubic-bezier(.2,.8,.2,1) both}
    .breathe{animation:breathe 3.6s 1.6s ease-in-out infinite}
    .pop{transform-box:fill-box;transform-origin:center;animation:pop .5s 1.1s cubic-bezier(.34,1.56,.64,1) both}
    .twinkle{transform-box:fill-box;transform-origin:center;animation:twinkle 2.8s 1.8s ease-in-out infinite}
    @keyframes draw{0%{stroke-dashoffset:1;opacity:0}6%{opacity:1}100%{stroke-dashoffset:0}}
    @keyframes fade{from{opacity:0}}
    @keyframes spill{from{transform:scaleY(0);opacity:0}}
    @keyframes breathe{50%{opacity:.6}}
    @keyframes pop{from{transform:scale(0) rotate(-45deg);opacity:0}}
    @keyframes twinkle{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(.78) rotate(22deg)}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
  return svg(
    `<style>${css}</style><g transform="${NUDGE}">
    <g class="breathe"><path class="in" d="${PATHS.inside}" fill="${light}" fill-opacity="${insideOpacity}"/>
    <path class="beam" d="${PATHS.beam}" fill="${light}" fill-opacity="${beamOpacity}"/></g>
    <path class="arch" pathLength="1" d="${PATHS.arch}" fill="none" stroke="${arch}" stroke-width="60" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="pop"><path class="twinkle" d="${PATHS.spark}" fill="${spark}"/></g>
  </g>`,
    bg,
  );
}

const BRAND = 'assets/brand';
mkdirSync(BRAND, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(path.join(BRAND, name), content);

const png = (source, size, out) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
const MOBILE = 'apps/mobile/assets/images';

await Promise.all([
  png(files['casalume-ikon-koyu.svg'], 1024, `${BRAND}/casalume-ikon-koyu-1024.png`),
  png(files['casalume-ikon-acik.svg'], 1024, `${BRAND}/casalume-ikon-acik-1024.png`),
  png(files['casalume-ikon-koyu-yuvarlak.svg'], 512, `${BRAND}/casalume-ikon-koyu-512.png`),
  png(files['casalume-ikon-acik-yuvarlak.svg'], 512, `${BRAND}/casalume-ikon-acik-512.png`),
  // Mobile (Expo): iOS/store icon, Android adaptive layers (mark inside the 66% safe zone), splash, web favicon.
  png(files['casalume-ikon-koyu.svg'], 1024, `${MOBILE}/icon.png`),
  png(svg(mark(DARK, 0.62)), 1024, `${MOBILE}/android-icon-foreground.png`),
  png(svg('', { bg: KIL.ink }), 1024, `${MOBILE}/android-icon-background.png`),
  png(svg(mark(MONO, 0.62)), 1024, `${MOBILE}/android-icon-monochrome.png`),
  png(svg(mark(DARK)), 512, `${MOBILE}/splash-icon.png`),
  png(files['casalume-ikon-koyu-yuvarlak.svg'], 48, `${MOBILE}/favicon.png`),
  // Admin and web (Next.js app icons).
  png(files['casalume-ikon-koyu.svg'], 180, 'apps/admin/src/app/apple-icon.png'),
  png(files['casalume-ikon-koyu.svg'], 180, 'apps/web/src/app/apple-icon.png'),
]);
writeFileSync('apps/admin/src/app/icon.svg', files['casalume-ikon-koyu-yuvarlak.svg']);
writeFileSync('apps/web/src/app/icon.svg', files['casalume-ikon-koyu-yuvarlak.svg']);
console.log('brand icons written');
