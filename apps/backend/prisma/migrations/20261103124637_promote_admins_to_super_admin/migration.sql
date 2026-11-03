-- Before roles existed, ADMIN could do everything. Keep that: existing admins become SUPER_ADMIN.
-- (Separate migration: a new enum value can only be used after the transaction that added it commits.)
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN';
