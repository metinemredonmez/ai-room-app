import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Built-in demo photos (vector scenes rendered once to JPEG) so the full flow can be tried without
// a camera — and without shipping third-party photos.

export const SAMPLE_IDS = ['living_room', 'empty_room', 'bedroom', 'exterior', 'garden'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

const W = 1280;
const H = 960;

function room(inner: string, wall = '#E9E1D3', side = '#DCD2C1', floor = '#B98B5E') {
  // One-point perspective shell: back wall, side walls, ceiling and a planked floor.
  const planks = Array.from({ length: 13 }, (_, i) => {
    const xb = 300 + i * 56.6;
    const xf = -160 + i * 133;
    return `<line x1="${xb}" y1="640" x2="${xf}" y2="${H}" stroke="#9C7148" stroke-width="2" opacity="0.5"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9CC7E8"/><stop offset="1" stop-color="#DDEEF7"/></linearGradient>
      <linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${wall}"/>
    <polygon points="0,0 300,170 300,640 0,${H}" fill="${side}"/>
    <polygon points="${W},0 980,170 980,640 ${W},${H}" fill="${side}"/>
    <polygon points="0,0 ${W},0 980,170 300,170" fill="#F4EFE6"/>
    <polygon points="300,640 980,640 ${W},${H} 0,${H}" fill="${floor}"/>
    ${planks}
    <rect x="300" y="170" width="680" height="470" fill="${wall}"/>
    <rect x="300" y="625" width="680" height="15" fill="#FFFFFF" opacity="0.7"/>
    <g>
      <rect x="560" y="230" width="260" height="250" fill="url(#sky)" stroke="#FFFFFF" stroke-width="12"/>
      <line x1="690" y1="230" x2="690" y2="480" stroke="#FFFFFF" stroke-width="8"/>
      <polygon points="560,480 820,480 900,640 480,640" fill="url(#light)"/>
    </g>
    <polygon points="40,200 200,250 200,690 40,780" fill="#C9B79C"/>
    ${inner}
  </svg>`;
}

const LIVING = room(`
  <rect x="345" y="250" width="150" height="110" fill="#FFFFFF" stroke="#7A6A55" stroke-width="6"/>
  <rect x="360" y="265" width="120" height="80" fill="#C77B58" opacity="0.8"/>
  <ellipse cx="640" cy="760" rx="330" ry="70" fill="#8E9AAF" opacity="0.85"/>
  <rect x="380" y="560" width="520" height="120" rx="26" fill="#6F7F8C"/>
  <rect x="380" y="500" width="520" height="90" rx="30" fill="#7D8D99"/>
  <rect x="350" y="540" width="70" height="150" rx="24" fill="#677784"/>
  <rect x="860" y="540" width="70" height="150" rx="24" fill="#677784"/>
  <rect x="540" y="700" width="200" height="22" rx="8" fill="#8B5A3C"/>
  <rect x="555" y="722" width="10" height="50" fill="#5C3B27"/><rect x="715" y="722" width="10" height="50" fill="#5C3B27"/>
  <line x1="1030" y1="420" x2="1030" y2="740" stroke="#333" stroke-width="6"/>
  <polygon points="985,360 1075,360 1055,420 1005,420" fill="#F3E3C3"/>
  <rect x="210" y="640" width="70" height="80" rx="10" fill="#B5643E"/>
  <circle cx="245" cy="600" r="55" fill="#4F7A4A"/><circle cx="215" cy="575" r="35" fill="#5E8C57"/>`);

const EMPTY = room(`
  <rect x="600" y="600" width="12" height="12" fill="#FFFFFF"/>
  <rect x="930" y="560" width="30" height="40" rx="4" fill="#FFFFFF" opacity="0.8"/>`,
  '#ECE7DF', '#DED7CB', '#C6A47C');

const BEDROOM = room(`
  <rect x="440" y="420" width="400" height="150" rx="20" fill="#5B6B5D"/>
  <rect x="400" y="560" width="480" height="150" rx="18" fill="#F4F1EA"/>
  <rect x="400" y="640" width="480" height="90" rx="14" fill="#C9B79C"/>
  <rect x="460" y="520" width="150" height="60" rx="20" fill="#FFFFFF"/>
  <rect x="670" y="520" width="150" height="60" rx="20" fill="#FFFFFF"/>
  <rect x="320" y="600" width="70" height="90" rx="6" fill="#8B5A3C"/>
  <rect x="890" y="600" width="70" height="90" rx="6" fill="#8B5A3C"/>
  <circle cx="355" cy="570" r="22" fill="#F3E3C3"/><circle cx="925" cy="570" r="22" fill="#F3E3C3"/>`,
  '#E6E0D6', '#D8CFC2', '#A88660');

const EXTERIOR = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FB2DE"/><stop offset="1" stop-color="#D6E9F5"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#s)"/>
  <ellipse cx="260" cy="160" rx="120" ry="40" fill="#fff" opacity="0.8"/><ellipse cx="980" cy="120" rx="150" ry="45" fill="#fff" opacity="0.7"/>
  <rect x="0" y="760" width="${W}" height="200" fill="#6E9A54"/>
  <rect x="300" y="380" width="680" height="400" fill="#D9D2C5"/>
  <polygon points="270,390 640,190 1010,390" fill="#6D4C3D"/>
  <rect x="380" y="450" width="130" height="120" fill="#5D7FA3" stroke="#FFFFFF" stroke-width="10"/>
  <rect x="770" y="450" width="130" height="120" fill="#5D7FA3" stroke="#FFFFFF" stroke-width="10"/>
  <rect x="380" y="620" width="130" height="110" fill="#5D7FA3" stroke="#FFFFFF" stroke-width="10"/>
  <rect x="580" y="600" width="120" height="180" fill="#7A4E36"/>
  <rect x="770" y="620" width="130" height="110" fill="#5D7FA3" stroke="#FFFFFF" stroke-width="10"/>
  <polygon points="560,780 720,780 820,${H} 460,${H}" fill="#BDB3A4"/>
  <circle cx="1120" cy="560" r="120" fill="#4B7A43"/><rect x="1105" y="640" width="30" height="140" fill="#5C4030"/>
  <circle cx="180" cy="700" r="70" fill="#5A8A4C"/>
</svg>`;

const GARDEN = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8CBDE6"/><stop offset="1" stop-color="#E3F0F8"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#s)"/>
  <rect x="0" y="420" width="${W}" height="540" fill="#8DB264"/>
  ${Array.from({ length: 26 }, (_, i) => `<rect x="${i * 50}" y="360" width="34" height="140" rx="6" fill="#F2EEE6"/>`).join('')}
  <rect x="0" y="390" width="${W}" height="14" fill="#E6E0D4"/><rect x="0" y="450" width="${W}" height="14" fill="#E6E0D4"/>
  <rect x="980" y="160" width="300" height="500" fill="#E9E3D7"/><rect x="1040" y="260" width="110" height="140" fill="#6C8FB0" stroke="#fff" stroke-width="8"/>
  <circle cx="180" cy="420" r="110" fill="#5C8A4E"/><circle cx="330" cy="440" r="80" fill="#6A9A58"/>
  <ellipse cx="640" cy="780" rx="520" ry="120" fill="#7FA457"/>
  <path d="M600 ${H} C 620 800, 700 650, 760 520" stroke="#C9BBA5" stroke-width="70" fill="none" opacity="0.8"/>
</svg>`;

const SCENES: Record<SampleId, string> = {
  living_room: LIVING,
  empty_room: EMPTY,
  bedroom: BEDROOM,
  exterior: EXTERIOR,
  garden: GARDEN,
};

export async function loadSample(dataDir: string, id: SampleId): Promise<Buffer> {
  const dir = path.resolve(dataDir, 'samples');
  const file = path.join(dir, `${id}.jpg`);
  try {
    return await readFile(file);
  } catch {
    await mkdir(dir, { recursive: true });
    const buf = await sharp(Buffer.from(SCENES[id])).blur(0.6).jpeg({ quality: 90 }).toBuffer();
    await writeFile(file, buf);
    return buf;
  }
}
