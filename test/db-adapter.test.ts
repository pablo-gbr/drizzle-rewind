import assert from "node:assert/strict";
import { test } from "node:test";

import { MySqlDatabaseAdapter } from "../src/db/mysql";
import { PostgresDatabaseAdapter } from "../src/db/postgres";

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
  assert.equal(adapter.isUndefinedTableError({ code: "ER_NO_SUCH_TABLE" }), true);
  assert.deepEqual(await adapter.query("SELECT ?", ["ok"]), [{ value: "ok" }]);
});
