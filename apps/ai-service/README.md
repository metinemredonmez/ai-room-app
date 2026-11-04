# Casalume — AI servisi (FastAPI)

Yalnız backend'in çağırdığı iç servis (`X-Internal-Token`). Dışarı açılmaz. Sözleşme: `docs/API.md` §5 ve §7.

| Uç | İş |
|---|---|
| `POST /internal/v1/generate` | Araç + stil + oda bilgisinden prompt kurar; sağlayıcı zinciriyle 1–4 varyant üretir; `usage` döndürür |
| `POST /internal/v1/quality` | Fotoğraf kalite puanı (karanlık, aşırı parlak, bulanık, düşük çözünürlük, düşük kontrast). Yalnız uyarı verir, engellemez |
| `POST /internal/v1/analyze` | Görseldeki ürünler, TL fiyat aralıkları, tadilat kalemleri, renk paleti + `usage` |
| `POST /internal/v1/chat` | Türkçe/İngilizce tasarım sohbeti; öneriler yalnız katalogdaki kimliklerle + `usage` |
| `GET /internal/v1/health` · `GET /healthz` | Durum; sağlayıcı başına devre kesici durumu |
| `GET /docs` · `GET /openapi.json` | Swagger UI ve şema — **yalnız `ENV != production`** |

**Sağlayıcı zinciri ve dayanıklılık (§7.4)**
- `IMAGE_PROVIDER` birincil sağlayıcıdır, `IMAGE_FALLBACKS` (ör. `replicate`) sırayla denenir. Sıradakine yalnız
  yeniden denenebilir hatada (408/429/5xx, zaman aşımı, bağlantı) ya da devre açıkken geçilir. 4xx ve güvenlik
  engelleri zinciri durdurur. Yanıttaki `usage.fallback_used` alanı yedeğe geçilip geçilmediğini gösterir.
- Devre kesici süreç içinde, sağlayıcı başına çalışır: 5 ardışık hatada 60 sn açılır, ardından tek bir deneme
  isteğiyle kontrol edilir. Durumu `/internal/v1/health` → `providers` alanındadır.
- Bir `generate` isteği toplam 150 sn'yi aşamaz (`GENERATE_TIME_BUDGET_S`); tek sağlayıcı çağrısı en çok 120 sn sürer.
- "Değişiklik yok" tespiti: girdiye neredeyse aynı çıkan varyant atılır (256 px gri ortalama fark < 3). Hiç varyant
  kalmazsa 422 `no_change` döner; gövdede o ana kadarki `usage` da bulunur, böylece backend krediyi iade ederken
  maliyeti de kaydedebilir.
- Hata gövdesi: `{"error": {"code", "message", "retryable"}}`. Backend yalnız `retryable: true` hatalarda yeniden dener.

**Bölge kilidi (§7.8).** Boya, zemin, değiştir ve hedefli silmede hedef bölgenin maskesi fal.ai SAM 3 ile, üretimle
aynı anda çıkarılır. Hangi sağlayıcı üretirse üretsin, çıktı yalnız maske içinde orijinalle birleştirilir; pencere, kapı
ve mobilya kullanıcının kendi pikselleriyle kalır. Maske çıkmazsa tasarım kilitsiz sürer, yanıttaki `region.reason`
nedenini söyler. `FAL_KEY` yoksa yalnız `mock` modunda etiketli geometrik maske kullanılır. Gerçek sağlayıcıda sahte
maske kullanılmaz. `REGION_LOCK=off` kilidi kapatır.

**Maliyet defteri (§7.2).** Her yanıtta şu alan döner:
`usage = {provider, model, kind, images, input_tokens, output_tokens, latency_ms, cost_usd, fallback_used}`.
- Görsel fiyatları env'den okunur (`GEMINI_IMAGE_COST_USD`, `REPLICATE_IMAGE_COST_USD`, `FALAI_IMAGE_COST_USD`; mock ücretsizdir).
- SAM 3 maske maliyeti (`FALAI_SEG_COST_USD`) aynı `generate` kaydına eklenir.
- Claude fiyatları da env'den okunur (`ANTHROPIC_*_USD_PER_MTOK`). Hesap, SDK'nın döndürdüğü token sayılarıyla yapılır.
- Anahtar yoksa dönen demo yanıtlarında `provider: "demo"` ve `cost_usd: 0` olur.
- `reference` aracında stil çözümlemenin Claude maliyeti `generate` kaydına eklenir.

**Claude.** Sohbet, analiz ve referans stil çözümleme `ANTHROPIC_API_KEY` ile çalışır. Ayarlar:
- Model `claude-opus-5-5`, yanıtlar structured output.
- `fallbacks: "default"` açık: ret halinde sunucu tarafında yedek model devreye girer.
- Effort: sohbette `low`, analizde `medium`.

```bash
cp .env.example .env   # INTERNAL_TOKEN = backend AI_INTERNAL_TOKEN
uv sync
uv run uvicorn app.main:app --port 8001
uv run pytest          # 42 test
uv run python scripts/export_openapi.py   # → docs/openapi/ai-service.json
```

**Güvenlik**
- İç token `hmac.compare_digest` ile karşılaştırılır.
- Gövde limiti 40 MB.
- Pillow ile `MAX_IMAGE_PIXELS` sınırı ve biçim doğrulaması yapılır; sağlayıcı çıktısı da yeniden doğrulanır.
- Kullanıcı metni prompt içinde yalnız veri olarak tırnaklanır.
- Türkçe normalizasyon (İ/ı, görünmez karakterler, "k a n e p e" gibi harf aralıkları) uygulanır.
- Replicate çıktısı yalnız `replicate.delivery` alan adından indirilir (SSRF koruması).
- fal.ai girdi/çıktısı satır içi data URI'dir. URL dönerse yalnız `https` ile fal'ın kendi alan adlarından indirilir.
- Model çıktısı katalogla filtrelenir.
- Swagger üretimde kapalıdır.
- Üretimde `mock` sağlayıcıyla, `mock` yedeğiyle, anahtarı olmayan bir sağlayıcıyla ya da zayıf token'la servis açılmaz.
