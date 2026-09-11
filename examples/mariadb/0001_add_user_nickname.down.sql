-- WARNING: DATA-LOSS: users.nickname may remove or reject values written after the migration.

ALTER TABLE `users` DROP COLUMN `nickname`;
