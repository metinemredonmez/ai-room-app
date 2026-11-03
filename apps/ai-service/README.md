# AI Room — AI servisi (FastAPI)

Yalnız backend'in çağırdığı iç servis (`X-Internal-Token`). Dışarı açılmaz.

| Uç | İş |
|---|---|
| `POST /internal/v1/generate` | Araç + stil + oda bilgisinden prompt kurar, görsel sağlayıcısına gönderir, 1–4 varyant döndürür |
| `POST /internal/v1/analyze` | Görseldeki ürünler, TL fiyat aralıkları, tadilat kalemleri, renk paleti |
| `POST /internal/v1/chat` | Türkçe/İngilizce tasarım sohbeti; öneriler yalnız katalogdaki kimliklerle |
| `GET /internal/v1/health` · `GET /healthz` | Durum |

**Sağlayıcılar.** Görsel sağlayıcısı `IMAGE_PROVIDER` ile seçilir:
- `mock`: anahtarsız, deterministik.
- `gemini`: `gemini-2.5-flash-image`.
- `replicate`: `black-forest-labs/flux-kontext-pro`.

Sohbet, analiz ve referans stil çözümleme `ANTHROPIC_API_KEY` ile Claude üzerinden çalışır. Kullanılan ayarlar:
- Model `claude-opus-5-5`.
- Structured output.
- `fallbacks: "default"` (ret halinde sunucu tarafı yedek model).
- Effort: sohbette `low`, analizde `medium`.

Anahtar yoksa deterministik demo yanıtları döner.

```bash
cp .env.example .env   # INTERNAL_TOKEN = backend AI_INTERNAL_TOKEN
uv sync
uv run uvicorn app.main:app --port 8001
uv run pytest          # 8 test
```

**Güvenlik.**
- İç token `hmac.compare_digest` ile karşılaştırılır.
- 40 MB gövde limiti uygulanır.
- Pillow ile `MAX_IMAGE_PIXELS` sınırı ve biçim doğrulaması yapılır.
- Kullanıcı metni prompt içinde yalnız veri olarak tırnaklanır.
- Replicate çıktısı yalnız `replicate.delivery` alan adından indirilir (SSRF koruması).
- Model çıktısı katalogla filtrelenir.
- Üretimde `mock` sağlayıcıyla veya zayıf token'la servis açılmaz.
