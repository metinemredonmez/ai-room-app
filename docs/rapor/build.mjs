#!/usr/bin/env node
// Builds docs/rapor/rapor.html from parts/ and renders the PDF with headless Chrome.
// Usage: node docs/rapor/build.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, '..');
const out = path.join(docs, 'AI-Room-Pazar-Arastirmasi-ve-MVP-Raporu.pdf');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cell(v, extraClass = '') {
  const sup = v.endsWith('ᵃ') ? '<sup>ᵃ</sup>' : '';
  const core = v.replace(/ᵃ$/, '');
  const cls = { '✓': 'y', '~': 'p', '✗': 'n', '?': 'u', M: 'm' }[core] ?? '';
  return `<td class="${[cls, extraClass].filter(Boolean).join(' ')}">${esc(core)}${sup}</td>`;
}

function matrix(cols, rows, { firstHeader, usCols = [] } = {}) {
  for (const [name, vals] of rows) {
    if (vals.length !== cols.length) throw new Error(`matrix row "${name}" has ${vals.length} cells, expected ${cols.length}`);
  }
  const head = `<tr><th>${firstHeader}</th>${cols.map((c, i) => `<th class="${usCols.includes(i) ? 'us' : ''}">${c}</th>`).join('')}</tr>`;
  const body = rows
    .map(([name, vals]) => `<tr><td>${name}</td>${vals.map((v, i) => cell(v, usCols.includes(i) ? 'us' : '')).join('')}</tr>`)
    .join('\n');
  return `<table class="matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ------------------------------------------------------------------ dünya taraması matrisi (§3)
const gCols = ['Restyle', 'Stil', 'Maske', 'Silme', 'Değiştir', 'Boş oda', 'Dış cephe', 'Bahçe', 'Boya', 'Zemin', 'Ref. görsel',
  '2D plan', '3D', 'Tarama', 'AR', 'Alışveriş', 'Maliyet', 'Sohbet', 'Video / 360', 'Pro / emlak', 'Türkçe'];
const s = (str) => str.trim().split(/\s+/);
const gRows = [
  ['<b>AI Remodel</b> (PulseApps)', s('✓ ? ? ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ~ᵃ ✗ ✗ ✗ ~ᵃ ✗ ✓ᵃ ✗ ✗ ✗')],
  ['Home AI (HubX)', s('✓ ? ? ~ ~ ✗ ✓ ✓ ✓ ~ ✗ ✗ ✗ ✗ ✗ ✗ ~ ✗ ✗ ✗ ✗')],
  ['Arch (AppNation)', s('✓ 10+ ✗ ✗ ✗ ✗ ? ✓ ~ ✗ ✗ ✗ ✗ ✗ ✗ ~ ✓ ✗ ✗ ✗ ✓')],
  ['Remodel AI (ReImage AI)', s('✓ 40+ ✓ ✓ ✓ ? ✓ ✓ ✓ ✓ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗')],
  ['RoomGPT', s('✓ ? ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ~ ?')],
  ['Interior AI', s('✓ 56 ✓ ✓ ~ ✓ ✓ ✓ ✓ ✗ ✓ ✗ ~ ✗ ✗ ~ ✗ ✗ ✓ ✓ ?')],
  ['HomeDesigns AI', s('✓ 200+ ✗ ✓ ✓ ✓ ✓ ✓ ~ ✓ ✗ ✓ ✓ ✗ ✗ ✓ ✓ ✗ ✓ ✓ ?')],
  ['REimagineHome', s('✓ ? ~ ✓ ✓ ✓ ✓ ✓ ✓ ~ ✓ ✗ ✗ ✗ ✗ ✓ ✗ ✓ ✗ ✓ ?')],
  ['Spacely AI', s('✓ ? ~ ✓ ~ ✓ ✓ ✓ ✗ ~ ✓ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ?')],
  ['Collov AI', s('✓ ? ✗ ✓ ~ ✓ ✓ ✓ ~ ~ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓ ?')],
  ['Homestyler', s('✓ ? ✗ ✗ ✗ ✓ ? ? M M ✓ ✓ ✓ ✗ ? ~ ✗ ✓ ✓ ✓ ?')],
  ['Planner 5D', s('✓ ? ✗ ✗ ✗ ✓ ~ ~ M M ✗ ✓ ✓ ✓ ✗ ✗ ✗ ~ ✗ ✓ ✓')],
  ['<b>Live Home 3D</b>', s('~ 260+ ✗ ✗ ✗ ✗ M M M M ✗ ✓ ✓ ✓ ✓ ✗ ✗ ✗ ✓ ~ ✗')],
  ['Coohom', s('~ ? ✗ ✗ ✗ ~ ✓ ? M M ✗ ✓ ✓ ✗ ✗ ~ ✗ ✗ ✓ ✓ ?')],
  ['magicplan', s('✗ – ✗ ✗ ✗ ✗ ✗ ✗ ✗ M ✗ ✓ ~ ✓ ? ✗ ✓ ✗ ~ ✓ ✗')],
  ['RoomSketcher', s('~ ? ✗ ✗ ✗ ✗ ✗ ✗ M M ✗ ✓ ✓ ~ ✗ ✗ ✗ ✗ ✓ ✓ ?')],
  ['Floorplanner / Roomstyler', s('✗ – ✗ ✗ ✗ ✗ ✗ ✗ M M ✗ ✓ ✓ ✗ ✗ ~ ✗ ✗ ? ✓ ?')],
  ['Sweet Home 3D', s('✗ – ✗ ✗ ✗ ✗ ✗ ✗ M M ✗ ✓ ✓ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ?')],
  ['Polycam', s('✗ – ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓ ✓ ? ✗ ✗ ✗ ✗ ✓ ?')],
  ['Twindo (eski Canvas)', s('✗ – ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓ ✓ ✗ ✗ ✗ ✗ ✗ ✓ ?')],
  ['IKEA Kreativ', s('✗ – ✗ ✓ ✓ ~ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓ ~ ✓ ✗ ✗ ✗ ✗ ?')],
  ['Pinterest Restyle (beta, ABD/CA)', s('✓ ~ ✓ ✓ ✓ ~ ✗ ~ ✓ ✗ ✓ ✗ ✗ ✗ ✗ ~ ✗ ~ ✗ ✗ ✗')],
  ['Wayfair Muse', s('~ ? ✗ ✗ ~ ✗ ✗ ✗ ✗ ✗ ~ ✗ ✗ ✗ ✗ ✓ ✗ ✗ ✗ ✗ ✗')],
  ['Gemini "Nano Banana" / ChatGPT', ['✓', 'prompt', ...s('~ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✗ ✗ ✗ ✗ ~ ~ ✓ ✗ ✗ ✓')]],
];

// ------------------------------------------------------- dünya–Türkiye–AI Room matrisi (§5)
const cCols = ['AI Remodel', 'Home AI', 'Arch', 'Interior AI', 'HomeDesigns AI', 'Planner 5D', 'Live Home 3D', 'SahiDeko', 'GenRoom',
  'AI Room MVP', 'AI Room yol haritası'];
const cRows = [
  ['Fotoğraftan yeniden tasarım', s('✓ ✓ ✓ ✓ ✓ ✓ ~ ~ ✓ ✓ ✓')],
  ['Stil sayısı', ['?', '?', '10+', '56', '200+', '?', '260+', '4', '?', '15', '15+']],
  ['Türk / Anadolu stilleri', s('✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓ ✓')],
  ['Maske / bölge düzenleme', s('? ? ✗ ✓ ✗ ✗ ✗ ? ? ✗ ✓')],
  ['Nesne silme / odayı boşaltma', s('✓ ~ ✗ ✓ ✓ ✗ ✗ ? ? ✓ ✓')],
  ['Eşya değiştirme', s('✓ ~ ✗ ~ ✓ ✗ ✗ ? ? ✓ ✓')],
  ['Boş odayı döşeme (sanal döşeme)', s('✓ ✗ ✗ ✓ ✓ ✓ ✗ ✓ ? ✓ ✓')],
  ['Dış cephe', s('✓ ✓ ? ✓ ✓ ~ M ? ? ✓ ✓')],
  ['Bahçe / peyzaj', s('✓ ✓ ✓ ✓ ✓ ~ M ? ? ✓ ✓')],
  ['Duvar boyası', s('✓ ✓ ~ ✓ ~ M M ? ? ✓ ✓')],
  ['Zemin', s('✓ ~ ✗ ✗ ✓ M M ? ? ✓ ✓')],
  ['Referans görselden stil', s('✓ ✗ ✗ ✓ ✗ ✗ ✗ ? ? ✓ ✓')],
  ['2D kat planı', s('~ᵃ ✗ ✗ ✗ ✓ ✓ ✓ ? ? ✗ ✓')],
  ['3D görünüm', s('✗ ✗ ✗ ~ ✓ ✓ ✓ ? ? ✗ ~')],
  ['LiDAR / oda tarama (ölçü)', s('✗ ✗ ✗ ✗ ✗ ✓ ✓ ? ? ✗ ✓')],
  ['AR yerleştirme', s('✗ ✗ ✗ ✗ ✗ ✗ ✓ ? ? ✗ ~')],
  ['Alışveriş (gerçek ürün)', s('~ᵃ ✗ ~ ~ ✓ ✗ ✗ ? ? ~ ✓')],
  ['Maliyet / bütçe tahmini', s('✗ ~ ✓ ✗ ✓ ✗ ✗ ? ? ✓ ✓')],
  ['TL fiyat + Türk mağaza linki', s('✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✗ ✓ ✓')],
  ['AI tasarım sohbeti', s('✓ᵃ ✗ ✗ ✗ ✗ ~ ✗ ? ? ✓ ✓')],
  ['Video / 360', s('✗ ✗ ✗ ✓ ✓ ✗ ✓ ? ? ✗ ✓')],
  ['Pro / emlakçı özellikleri', s('✗ ✗ ✗ ✓ ✓ ✓ ~ ✓ ✓ ✗ ✓')],
  ['Türkçe arayüz', s('✗ ✗ ✓ ? ? ✓ ✗ ✓ ✓ ✓ ✓')],
  ['Android uygulaması', s('✓ ✓ ✗ ✗ ✗ ✓ ✗ ? ✗ ✓ ✓')],
  ['Web sürümü', s('? ? ✗ ✓ ✓ ✓ ✗ ✓ ✓ ✓ ✓')],
  ['Reklamsız / reklam takibi yok', s('✗ ? ? ? ? ? ? ? ? ✓ ✓')],
  ['Giriş fiyatı', ['₺229,99+/hf', '₺199,99+/hf', '₺299,99+/hf', '$49+/ay', '~$27/ay', '₺174,99/hf', '$6,99/ay', '?', '$9,99+ paket', '₺149,99/hf', '₺149,99/hf']],
];

// --------------------------------------------------------------------------------- kaynakça
const REFS = [
  ['AI Remodel — App Store (ABD)', 'https://apps.apple.com/us/app/-/id6477533581'],
  ['AI Remodel — App Store (TR)', 'https://apps.apple.com/tr/app/id6477533581'],
  ['AppGoblin — AI Remodel', 'https://appgoblin.info/apps/6477533581'],
  ['androidrank — AI Remodel', 'https://www.androidrank.org/application/ai_remodel_interior_design/pro.airemodel.android'],
  ['Home AI — App Store (ABD)', 'https://apps.apple.com/us/app/id6464476667'],
  ['Home AI — App Store (TR)', 'https://apps.apple.com/tr/app/id6464476667'],
  ['Pulse2 — HubX, Point72 yatırımı', 'https://pulse2.com/hubx-raises-50-million-from-point72-at-1-2-billion-pre-money-valuation-with-option-for-another-25-million'],
  ['androidrank — Home AI', 'https://www.androidrank.org/application/home_ai_ai_interior_design/interior.home.design.ai'],
  ['Arch — App Store', 'https://apps.apple.com/us/app/id6446172225'],
  ['Remodel AI — App Store', 'https://apps.apple.com/us/app/id6446040791'],
  ['Remodel AI — blog', 'https://www.remodelai.io/blog/best-ai-remodel-apps'],
  ['RoomGPT', 'https://www.roomgpt.io/'],
  ['RoomGPT — GitHub', 'https://github.com/Nutlope/roomGPT'],
  ['DecorAI — karşılaştırma yazısı', 'https://decorai.io/blog/best-ai-interior-design-tools.md'],
  ['Interior AI', 'https://interiorai.com/'],
  ['HomeDesigns AI — fiyatlar', 'https://homedesigns.ai/pricing'],
  ['REimagineHome — fiyatlar', 'https://www.reimaginehome.ai/pricing'],
  ['CB Insights — Styldod', 'https://www.cbinsights.com/compare/styledod-vs-virtual-staging-ai'],
  ['Spacely AI — fiyatlar', 'https://www.spacely.ai/pricing'],
  ['raising.fi — Collov A serisi', 'https://raising.fi/news/collov-labs-series-a-april-2026'],
  ['Zillow — Virtual Staging AI satın alımı', 'https://www.zillowgroup.com/news/zillow-group-acquires-ai-company-offering-virtual-staging'],
  ['RealEstateNews — Zillow Showcase', 'https://www.realestatenews.com/2025/09/10/zillow-adds-ai-powered-virtual-staging-to-showcase'],
  ['Homestyler — fiyatlar', 'https://www.homestyler.com/pricing'],
  ['Planner 5D — fiyatlar', 'https://www.planner5d.com/pricing'],
  ['Planner 5D — hakkında', 'https://planner5d.com/pages/about'],
  ['tech.eu — Planner 5D AI', 'https://tech.eu/2023/03/23/planner-5d-inveils-ai-design-generator-to-transform-your-space-in-seconds/'],
  ['TidBITS — Live Home 3D 5', 'https://tidbits.com/?p=76077'],
  ['SCMP — Manycore halka arzı', 'https://www.scmp.com/business/banking-finance/article/3350387/manycore-one-hangzhous-six-little-dragons-surges-hong-kong-ipo-debut'],
  ['Pandaily — Manycore', 'https://pandaily.com/?p=168549'],
  ['Coohom — fiyatlar', 'https://www.coohom.com/pricing'],
  ['RoomSketcher — fiyatlar', 'https://www.roomsketcher.com/pricing/'],
  ['Floorplanner — fiyatlar', 'https://floorplanner.com/pricing'],
  ['Sweet Home 3D — SourceForge', 'https://sourceforge.net/app/sweet-home-3d/'],
  ['Twindo — App Store', 'https://apps.apple.com/us/app/id1169235377'],
  ['illustrarch — Twindo', 'https://illustrarch.com/?p=110335'],
  ['Apple RoomPlan', 'https://developer.apple.com/augmented-reality/roomplan'],
  ['IKEA Kreativ', 'https://www.ikea.com/ca/en/newsroom/corporate-news/ikea-canada-launches-new-ai-powered-digital-experience-called-ikea-kreativ-pubf6d0f5d0'],
  ['TechCrunch — Pinterest Restyle', 'https://techcrunch.com/2026/09/17/pinterest-teases-a-new-restyle-feature-that-lets-you-redesign-your-room-with-ai/'],
  ['Wayfair — Muse', 'https://www.aboutwayfair.com/category/company-news/wayfair-introduces-new-ai-powered-tool-muse-to-inspire-and-personalize-the-home-shopping-experience'],
  ['Business of Home — Wayfair Muse', 'https://businessofhome.com/articles/wayfair-s-new-tool-shows-ai-s-strengths-and-limitations'],
  ['Engadget — Amazon AR', 'https://www.engadget.com/amazon-ar-shopping-furniture-home-decor-171005257.html'],
  ['Business of Home — Google AI', 'https://businessofhome.com/articles/should-designers-worry-about-google-s-new-ai-tool'],
  ['Google — ev dekorasyonu rehberi', 'https://blog.google/products-and-platforms/products/search/home-decor-tips/'],
  ["Tom's Guide — ChatGPT ile oda tasarımı", 'https://www.tomsguide.com/ai/how-to-use-chatgpt-to-redesign-any-room-see-smarter-layouts-and-picks-for-any-space'],
  ['Product Hunt — Interiores AI', 'https://www.producthunt.com/products/interiores-ai/launches'],
  ['App Store — "Nano-Banana" klon örneği', 'https://apps.apple.com/us/app/-/id6744328873'],
  ['Houzz — App Store', 'https://apps.apple.com/us/app/houzz-home-design-remodel/id399563465'],
  ['Houzz — basın', 'https://www.houzz.com/press'],
  ['Havenly — tasarım ücretleri', 'https://havenly.com/interior-design-cost'],
  ['Research and Markets — AI in Interior Design', 'https://www.researchandmarkets.com/reports/6226842/ai-in-interior-design-market-report'],
  ['SNS Insider — AI interior design', 'https://www.snsinsider.com/reports/ai-interior-design-market-8400'],
  ['MarketResearch — AI interior design tools', 'https://www.marketresearch.com/LP-Information-Inc-v4134/Global-AI-Interior-Design-Tools-39677115'],
  ['DIResearch — virtual staging', 'https://www.marketresearch.com/Deep-Insights-Research-Co-DIR-v4285/Global-Virtual-Staging-Real-Estate-41706804'],
  ['Sensor Tower — AI apps 2025', 'https://sensortower.com/blog/state-of-ai-apps-market-overview-2025'],
  ['Eastmoney — Sensor Tower 2026', 'https://finance.eastmoney.com/a/202605143737102961.html'],
  ['Fundraise Insider — Drafted', 'https://fundraiseinsider.com/blog/drafted-raises-16m-seed-for-ai-home-design-models/'],
  ['EU-Startups — Rayon', 'https://www.eu-startups.com/2026/09/paris-based-rayon-raises-e10-million-to-build-the-drawing-layer-for-interior-designs-ai-era'],
  ['Apple — TR Grafik ve Tasarım hasılat listesi RSS', 'https://itunes.apple.com/tr/rss/topgrossingapplications/limit=100/genre=6027/json'],
  ['Forbes TR — HubX', 'https://www.forbes.com.tr/yapay-zeka/hubx-75-milyon-dolar-yatirimla-turkiye-nin-yeni-unicorn-u-oldu'],
  ['Builtin — AppNation', 'https://builtin.com/company/appnation'],
  ['Forbes TR — AppNation', 'https://www.forbes.com.tr/yapay-zeka/appnation-kuresel-mobil-uygulama-pazarinda-sessizce-buyuyor'],
  ['Ruma — App Store', 'https://apps.apple.com/tr/app/id6742654523'],
  ['mwm.ai — Syntina', 'https://mwm.ai/apps/syntina-ai/6776306022'],
  ['Webrazzi — Oda Studio', 'https://webrazzi.com/2021/12/08/yapay-zeka-destekli-fotograf-gelistirme-cozumleri-sunan-oda-studio-navitas-capital-liderliginde-28-milyon-dolar-yatirim-aldi/'],
  ['Webrazzi — artlabs', 'https://webrazzi.com/2022/05/26/metaverse-odakli-3d-ve-ar-platformu-art-labs-700-bin-dolar-yatirim-aldi/'],
  ['Webrazzi — Boxlin', 'https://webrazzi.com/2018/06/20/kullanicilarin-evlerini-3d-olarak-planlamasini-saglayan-yerli-dekorasyon-girisimi-boxlin/'],
  ['Product Hunt — QuickStaging', 'https://www.producthunt.com/p/quickstaging'],
  ['GenRoom — hakkımızda', 'https://genroom.io/tr/hakkimizda'],
  ['GenRoom — fiyatlar', 'https://genroom.io/tr/fiyatlar'],
  ['IKEA TR — planlayıcılar', 'https://www.ikea.com.tr/planlayicilar'],
  ['IKEA TR — App Store', 'https://apps.apple.com/tr/app/id1147147196'],
  ['Karaca — App Store', 'https://apps.apple.com/tr/app/id1547965580'],
  ['İnternethaber — Karaca AIDA', 'https://www.internethaber.com/karaca-yapay-zeka-asistani-aidayi-chatgptde-kullanima-sundu-2451184h.htm'],
  ['Koçtaş — mutfak hizmeti', 'https://www.koctas.com.tr/nakliye-ve-montaj-hizmetleri/mutfak'],
  ['Ustabilir — App Store', 'https://apps.apple.com/tr/app/id1267241540'],
  ['Alfemo — App Store', 'https://apps.apple.com/tr/app/id1054806822'],
  ['Marshall Gör&Boya — App Store', 'https://apps.apple.com/tr/app/id526432420'],
  ['Filli Boya i-Colour — App Store', 'https://apps.apple.com/tr/app/id6753799237'],
  ['Dyo — App Store', 'https://apps.apple.com/tr/app/id1589747591'],
  ['Kalekim KaleCore — App Store', 'https://apps.apple.com/tr/app/id1546990426'],
  ['NG Kütahya — App Store', 'https://apps.apple.com/tr/app/id1480551987'],
  ['Webrazzi — VitrA VitreAlity', 'https://webrazzi.com/2015/11/03/vitranin-artirilmis-gerceklik-uygulamasi-vitreality-yayinlandi/'],
  ['Webrazzi — Hepsiburada AI', 'https://webrazzi.com/2023/09/26/hepsiburadadan-devrim-yaratan-yapay-zeka-entegrasyonlari/'],
  ['LOG — SahiDeko', 'https://www.log.com.tr/?p=957550'],
  ['CB Insights — Emlakjet', 'https://www.cbinsights.com/company/emlakjetcom'],
  ['Teknoblog — sahiAI', 'https://www.teknoblog.com/sahibinden-com-sahiai-yapay-zeka-ilan-arama/'],
  ['Hepsiemlak — App Store', 'https://apps.apple.com/tr/app/id496855282'],
  ['Emlakjet — App Store', 'https://apps.apple.com/tr/app/id1194656334'],
  ['Endeksa — App Store', 'https://apps.apple.com/tr/app/id1272606231'],
  ['Armut — İstanbul iç mimar fiyatları', 'https://armut.com/fiyatlari/istanbul-ic-mimar_100_34'],
  ['Homely AI — App Store', 'https://apps.apple.com/tr/app/id6757994164'],
  ['ReRoom AI — App Store', 'https://apps.apple.com/tr/app/id6749894179'],
  ['DecAI — App Store', 'https://apps.apple.com/tr/app/id6502747597'],
  ['Planner 5D — App Store (TR)', 'https://apps.apple.com/tr/app/id606173978'],
  ['Home Planner AI — App Store', 'https://apps.apple.com/tr/app/id1076159017'],
  ['Homestyler — App Store (TR)', 'https://apps.apple.com/tr/app/id601137449'],
  ['Alomaliye — 2025 konut satışları', 'https://www.alomaliye.com/2026/01/20/2025-yilinda-1-milyon-688-bin-910-konut-satildi/'],
  ['Alomaliye — Eylül 2026 konut satışları', 'https://www.alomaliye.com/2026/10/16/konut-satislari-eylulde-yuzde-93-geriledi/amp/'],
  ['Posta — yapı ruhsatı', 'https://www.posta.com.tr/galeri/-ev-sahibi-olmak-isteyenler-dikkat-piyasada-dengeleri-degistirecek-1-1-milyon-detayi-2975865'],
  ['Dünya — hanehalkı', 'https://www.dunya.com/ekonomik-veriler/tuik-hanehalki-kuculuyor-tek-kisilik-yasam-artiyor-haberi-824831'],
  ['Alomaliye — İstanbul dönüşüm', 'https://www.alomaliye.com/2026/08/17/istanbulda-donusum-1-milyonu-asti/'],
  ['Para — dönüşüm hedefi', 'https://www.paradergi.com.tr/is-dunyasi-kulis/2026/03/02/hedefimiz-afetlere-direncli-sehirler'],
  ['Bigpara — Yarısı Bizden', 'https://bigpara.hurriyet.com.tr/haberler/konut-haberleri/istanbulda-kampanyali-donusum-385-bine-ulasti-son-tarih-31-aralik_ID102235567/'],
  ['Türkgün — deprem konutları', 'https://www.turkgun.com/gundem/yil-sonuna-kadar-453-bin-konut-ve-is-yeri-teslim-edilecek/301541'],
  ['NTV — 350 bininci konut', 'https://www.ntv.com.tr/turkiye/bakan-kurumdan-deprem-bolgesinde-350-bininci-konut-paylasimi-1696356'],
  ['Dünya — mobilya ihracatı', 'https://www.dunya.com/ihracat/turk-mobilya-sektoru-dunyada-ilk-7de-ihracatta-yeni-hedef-10-milyar-dolar-haberi-826338'],
  ['Dünya — e-ticaret hacmi', 'https://www.dunya.com/ekonomik-veriler/e-ticarette-dev-buyume-hacim-45-trilyon-lirayi-gecti-haberi-840243'],
  ['24 Saat — TÜİK bilişim 2026', 'https://www.24saatgazetesi.com/tuik-2026-bilisim-raporu-aciklandi-internet-kullanimi-yuzde-923e-yukseldi-whatsapp-kullanimi-zirvede'],
  ['StatCounter — Türkiye mobil OS', 'https://gs.statcounter.com/os-market-share/mobile/turkey'],
  ['CNN Türk — 2026 asgari ücret', 'https://www.cnnturk.com/ekonomi/2026-asgari-ucret-resmi-gazetede-yayimlandi-2377320'],
  ['Oksijen — Eylül 2026 enflasyon', 'https://gazeteoksijen.com/ekonomi/eylulde-enflasyon-yillik-yuzde-29-73-aylik-yuzde-1-84-oldu-291680'],
  ['Foreks — RevenueCat raporu', 'https://www.foreks.com/haber/detay/6ae1ac87422c786f3f7ab76d/FRKS/tr/revenuecat-in-eylul-2025agustos-2026-raporuna-gore-turk-mobil-uygulamalarinin-abonelik-gelirlerinin-yuzde-89-u-yurt-disindan-geliyor-28-10-26/'],
  ['LOG — dijital hizmet vergisi', 'https://www.log.com.tr/?p=993161'],
  ['Alomaliye — Apple soruşturması', 'https://www.alomaliye.com/2024/06/07/apple-inc-ve-apple-teknoloji-ve-satis-ltd-sti-hakkinda-sorusturma-acildi/'],
  ['Ticimax — iyzico komisyonları', 'https://www.ticimax.com/blog/iyzico-komisyon-oranlari'],
  ['ETBİS', 'https://etbis.ticaret.gov.tr'],
  ['İYS', 'https://iys.org.tr'],
  ['Erdem & Erdem — yurt dışına aktarım rehberi', 'https://www.erdem-erdem.av.tr/bilgi-bankasi/yurt-disina-kisisel-veri-aktarimi-rehberi-neleri-duzenliyor'],
  ['Cottgroup — standart sözleşme bildirimi', 'https://cottgroup.com/tr/blog/kvkk-gdpr/item/standart-sozlesme-bildirim-yukumlulugu-ve-yaptirimlari'],
  ['Alomaliye — KVKK üretken AI rehberi', 'https://www.alomaliye.com/2025/11/24/sorularla-uretken-yapay-zeka-ve-kisisel-verilerin-korunmasi-rehberi/'],
  ['Dünya — dijital abonelik incelemesi', 'https://www.dunya.com/ekonomi/dijital-aboneliklerde-onaysiz-yenileme-mercek-altinda-bakanlik-inceleme-baslatti-haberi-844536'],
  ['Hukukçular Evi — otomatik yenileme', 'https://hukukcularevi.com/otomatik-yenilenen-abonelik-6502-bilgilendirme-iptal/'],
  ['NTV — reklam yönetmeliği', 'https://www.ntv.com.tr/turkiye/aldatici-indirim-ve-yapay-zeka-reklamlarina-yeni-onlem-1730847'],
  ['Türkiye — emlak fotoğraf cezası', 'https://www.turkiyegazetesi.com.tr/ekonomi/sahte-fotograflar-kullandilar-dolandirici-emlakcilar-ticaret-bakanligina-takildi-997058'],
  ['Ekonomi Gazetesi — evlilik kredisi', 'https://www.ekonomigazetesi.com/sektor-haberleri/sektor-2025e-evlilik-kredisi-mujdesiyle-girdi-52036'],
];

function references() {
  return `<ol class="refs">${REFS.map(([t, u]) => `<li>${esc(t)} — <a href="${u}">${esc(u)}</a></li>`).join('\n')}</ol>`;
}

// ------------------------------------------------------------------------------ ekran görüntüleri
const CAPTIONS = {
  '01-ornek-girdi-oturma-odasi': 'Önce: uygulamanın yerleşik örnek fotoğrafı (oturma odası)',
  '02-gemini-modern-turk-sonucu': 'Sonra: gerçek Gemini 2.5 Flash Image çıktısı · "Modern Türk" stili (~9 sn)',
  '10-mobil-ana-sayfa': 'Mobil · Ana Sayfa',
  '11-mobil-yeni-tasarim': 'Mobil · Yeni tasarım (araç, fotoğraf, seçenekler)',
  '12-mobil-once-sonra': 'Mobil · Önce/sonra ve "Yapay zekâ ile oluşturulmuştur" etiketi',
  '13-mobil-alisveris-butce': 'Mobil · Alışveriş listesi ve TL bütçe',
  '20-web-tanitim': 'Web · Tanıtım sayfası',
  '21-web-studyo-bahce-sonucu': 'Web · Stüdyo, bahçe yeniden tasarım sonucu',
  '22-web-tasarimlarim': 'Web · Tasarımlarım',
  '30-admin-mfa-giris': 'Admin · Parola + TOTP ile MFA girişi',
  '31-admin-gosterge-paneli': 'Admin · Gösterge paneli',
  '32-admin-tasarim-moderasyonu': 'Admin · Tasarım moderasyonu',
};
const autoCaption = (stem) => stem.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

function screenshots() {
  const dir = path.join(docs, 'screenshots');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
  if (!files.length) return '<p class="muted">Bu sürümde ekran görüntüsü bulunmuyor.</p>';
  const fig = (f, label, cls = '') => {
    const stem = f.replace(/\.png$/i, '');
    return `<figure class="${cls}"><img src="../screenshots/${encodeURIComponent(f)}" alt="${esc(CAPTIONS[stem] ?? autoCaption(stem))}"><figcaption>${label ? `<b>${label}</b> — ` : ''}${esc(CAPTIONS[stem] ?? autoCaption(stem))}</figcaption></figure>`;
  };
  const groups = [
    ['Şekil A — Önce / sonra (gerçek sağlayıcı)', files.filter((f) => /^0\d-/.test(f)), 'shots'],
    ['Mobil uygulama (Expo)', files.filter((f) => /^1\d-/.test(f)), 'shots4'],
    ['Web uygulaması (Next.js)', files.filter((f) => /^2\d-/.test(f)), 'shots'],
    ['Admin paneli (Next.js)', files.filter((f) => /^3\d-/.test(f)), 'shots'],
    ['Diğer', files.filter((f) => !/^[0-3]\d-/.test(f)), 'shots'],
  ];
  return groups
    .filter(([, fs]) => fs.length)
    .map(([title, fs, cls]) => `<h2>${title}</h2><div class="${cls}">${fs.map((f) => fig(f, '')).join('')}</div>`)
    .join('\n');
}

// ---------------------------------------------------------------------------------------- build
const partsDir = path.join(here, 'parts');
const parts = readdirSync(partsDir).filter((f) => f.endsWith('.html')).sort();
let body = parts.map((f) => readFileSync(path.join(partsDir, f), 'utf8')).join('\n');
body = body
  .replace('<!--MATRIX:global-->', matrix(gCols, gRows, { firstHeader: 'Ürün' }))
  .replace('<!--MATRIX:compare-->', matrix(cCols, cRows, { firstHeader: 'Özellik', usCols: [9, 10] }))
  .replace('<!--SCREENSHOTS-->', screenshots())
  .replace('<!--REFERENCES-->', references());
if (/<!--(MATRIX|SCREENSHOTS|REFERENCES)/.test(body)) throw new Error('unreplaced placeholder');

const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<title>AI Room — Pazar Araştırması, Rakip Analizi ve MVP Raporu</title>
<link rel="stylesheet" href="style.css">
</head><body>
${body}
</body></html>`;
const htmlPath = path.join(here, 'rapor.html');
writeFileSync(htmlPath, html);
console.log(`html: ${htmlPath} (${(html.length / 1024).toFixed(0)} KB, ${REFS.length} kaynak)`);

if (process.argv.includes('--html-only')) process.exit(0);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(path.join(tmpdir(), 'airoom-pdf-'));
execFileSync(chrome, [
  '--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
  '--no-pdf-header-footer', '--virtual-time-budget=5000', `--print-to-pdf=${out}`, `file://${htmlPath}`,
], { stdio: 'inherit' });
console.log(`pdf: ${out}`);
