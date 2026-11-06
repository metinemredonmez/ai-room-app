-- API.md §7.51: the owner's permission to show a design in the public inspiration gallery.
ALTER TABLE "Design" ADD COLUMN "shareConsentAt" TIMESTAMP(3);

-- Demo designs belong to fake accounts (seed-demo, never a real person): they keep their place in the gallery.
UPDATE "Design" d SET "shareConsentAt" = d."createdAt"
FROM "User" u
WHERE d."userId" = u.id AND d.featured
  AND (u.email LIKE '%@demo.casalume.invalid' OR u.email LIKE '%@demo.airoom.local');

-- Any other featured design leaves the gallery until its owner allows it (nothing is deleted).
UPDATE "Design" SET featured = false WHERE featured AND "shareConsentAt" IS NULL;

-- A featured design always has its owner's permission.
ALTER TABLE "Design" ADD CONSTRAINT "Design_featured_needs_consent" CHECK (featured = false OR "shareConsentAt" IS NOT NULL);
