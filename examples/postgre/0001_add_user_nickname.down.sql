-- WARNING: DATA-LOSS: users.nickname may remove or reject values written after the migration.

ALTER TABLE "public"."users" DROP COLUMN "nickname";
