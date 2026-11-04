# Style previews

One photo per catalog style, served by `GET /v1/styles/:id/preview.jpg` (resized to 640 px and cached).
Each is the sample living room (`../samples/living_room.jpg`, Pexels, Rachel Claire — see `../samples/CREDITS.md`)
redesigned in that style with the production image model, Gemini `gemini-3.1-flash-image` (Nano Banana 2),
on 4 November 2026. Every photo carries the visible "Casalume · Yapay zekâ ile oluşturulmuştur" label and is
stored at 1280 px wide (JPEG).

When the photos change, bump `STYLE_PHOTOS_VERSION` in `src/catalog/catalog.service.ts` so cached previews
are rebuilt. A style without a photo here falls back to the palette-tinted sample.
