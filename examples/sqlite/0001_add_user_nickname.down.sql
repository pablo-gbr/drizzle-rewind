-- WARNING: DATA-LOSS: users.nickname may remove or reject values written after the migration.

CREATE TABLE IF NOT EXISTS "__drizzle_rewind_users" (
	"id" integer PRIMARY KEY NOT NULL AUTOINCREMENT,
	"email" text NOT NULL
);--> statement-breakpoint
INSERT INTO "__drizzle_rewind_users" ("id", "email") SELECT "id", "email" FROM "users";--> statement-breakpoint
DROP TABLE "users";--> statement-breakpoint
ALTER TABLE "__drizzle_rewind_users" RENAME TO "users";
