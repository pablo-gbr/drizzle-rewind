import assert from "node:assert/strict";
import { test } from "node:test";

import { migrationsTableDisplayName } from "../src/db/adapter";
import { MySqlDatabaseAdapter } from "../src/db/mysql";
import { PostgresDatabaseAdapter } from "../src/db/postgres";
import {
  SQLITE_CREATE_MIGRATIONS_TABLE,
  SQLiteDatabaseAdapter,
} from "../src/db/sqlite";

test("Postgres adapter normalizes rows and placeholders", async () => {
  const adapter = new PostgresDatabaseAdapter({
    async query(sql: string, params?: unknown[]) {
      assert.equal(sql, "SELECT $1");
      assert.deepEqual(params, ["ok"]);
      return { rows: [{ value: "ok" }] };
    },
  });

  assert.equal(adapter.placeholder(1), "$1");
  assert.equal(adapter.migrationsTable, '"drizzle"."__drizzle_migrations"');
  assert.equal(migrationsTableDisplayName(adapter), "drizzle.__drizzle_migrations");
  assert.deepEqual(await adapter.query("SELECT $1", ["ok"]), [{ value: "ok" }]);
});

test("MySQL adapter normalizes rows, placeholders, and missing table errors", async () => {
  const adapter = new MySqlDatabaseAdapter({
    async query(sql: string, params?: unknown[]) {
      assert.equal(sql, "SELECT ?");
      assert.deepEqual(params, ["ok"]);
      return [[{ value: "ok" }], []];
    },
    async execute() {
      return [{ affectedRows: 1 }, []];
    },
  });

  assert.equal(adapter.placeholder(1), "?");
  assert.equal(adapter.migrationsTable, "`__drizzle_migrations`");
  assert.equal(migrationsTableDisplayName(adapter), "__drizzle_migrations");
  assert.equal(adapter.isUndefinedTableError({ code: "ER_NO_SUCH_TABLE" }), true);
  assert.deepEqual(await adapter.query("SELECT ?", ["ok"]), [{ value: "ok" }]);
});

test("SQLite adapter normalizes rows, placeholders, transactions, and missing table errors", async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const adapter = new SQLiteDatabaseAdapter({
    async execute(stmt: string | { sql: string; args?: unknown[] }) {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      const args = typeof stmt === "string" ? [] : stmt.args ?? [];
      calls.push({ sql, args });
      return { rows: sql === "SELECT ?" ? [{ value: "ok" }] : [] };
    },
  });

  assert.equal(adapter.placeholder(1), "?");
  assert.equal(adapter.migrationsTable, '"__drizzle_migrations"');
  assert.equal(migrationsTableDisplayName(adapter), "__drizzle_migrations");
  assert.equal(adapter.isUndefinedTableError({ message: "SQLITE_ERROR: no such table: x" }), true);
  assert.equal(adapter.isUndefinedTableError({ code: "SQLITE_ERROR", message: "syntax error" }), false);
  assert.deepEqual(await adapter.query("SELECT ?", ["ok"]), [{ value: "ok" }]);

  await adapter.transaction(async (tx) => {
    await tx.execute("UPDATE things SET value = ?", ["ok"]);
  });

  assert.deepEqual(calls, [
    { sql: "SELECT ?", args: ["ok"] },
    { sql: "BEGIN", args: [] },
    { sql: "UPDATE things SET value = ?", args: ["ok"] },
    { sql: "COMMIT", args: [] },
  ]);
});

test("SQLite tracking table DDL matches Drizzle legacy migration columns", () => {
  assert.match(SQLITE_CREATE_MIGRATIONS_TABLE, /CREATE TABLE IF NOT EXISTS "__drizzle_migrations"/);
  assert.match(SQLITE_CREATE_MIGRATIONS_TABLE, /id integer PRIMARY KEY AUTOINCREMENT NOT NULL/);
  assert.match(SQLITE_CREATE_MIGRATIONS_TABLE, /hash text NOT NULL/);
  assert.match(SQLITE_CREATE_MIGRATIONS_TABLE, /created_at numeric/);
});
