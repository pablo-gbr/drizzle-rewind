import assert from "node:assert/strict";
import { test } from "node:test";

import { parseResetArgs, resetStatements } from "../src/commands/reset";
import type { DatabaseAdapter } from "../src/db/adapter";

test("reset args keep drizzle-kit pass-through options", () => {
  assert.deepEqual(
    parseResetArgs([
      "--dialect",
      "mariadb",
      "--force",
      "--migrate",
      "--config",
      "drizzle.config.ts",
    ]),
    {
      force: true,
      dryRun: false,
      migrate: true,
      drizzleKitArgs: ["--config", "drizzle.config.ts"],
    },
  );
});

test("mysql reset drops views before tables with escaped identifiers", async () => {
  const adapter = fakeAdapter("mysql", async (sql) => {
    if (sql.includes("information_schema.tables")) {
      return [{ table_name: "users`archive" }] as never[];
    }
    if (sql.includes("information_schema.views")) {
      return [{ table_name: "active_users" }] as never[];
    }
    if (sql.includes("information_schema.routines")) {
      return [{ routine_name: "refresh_users", routine_type: "PROCEDURE" }] as never[];
    }
    if (sql.includes("information_schema.events")) {
      return [{ event_name: "nightly_refresh" }] as never[];
    }
    return [];
  });

  assert.deepEqual(await resetStatements(adapter), [
    "SET FOREIGN_KEY_CHECKS = 0",
    "DROP VIEW IF EXISTS `active_users`",
    "DROP TABLE IF EXISTS `users``archive`",
    "DROP PROCEDURE IF EXISTS `refresh_users`",
    "DROP EVENT IF EXISTS `nightly_refresh`",
    "SET FOREIGN_KEY_CHECKS = 1",
  ]);
});

test("sqlite reset ignores sqlite internal objects", async () => {
  const adapter = fakeAdapter("sqlite", async () => [
    { type: "view", name: "active_users" },
    { type: "table", name: 'users"archive' },
  ] as never[]);

  assert.deepEqual(await resetStatements(adapter), [
    'DROP VIEW IF EXISTS "active_users"',
    'DROP TABLE IF EXISTS "users""archive"',
  ]);
});

function fakeAdapter(
  dialect: DatabaseAdapter["dialect"],
  query: DatabaseAdapter["query"],
): DatabaseAdapter {
  return {
    dialect,
    migrationsTable: "__drizzle_migrations",
    placeholder: () => "?",
    query,
    execute: async () => {},
    transaction: async (fn) => fn(fakeAdapter(dialect, query)),
    close: async () => {},
    isUndefinedTableError: () => false,
  };
}
