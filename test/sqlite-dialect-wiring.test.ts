import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDialect } from "../src/dialects/resolve";
import { sqliteDialect } from "../src/dialects/sqlite";

test("resolves SQLite dialect aliases", () => {
  assert.equal(resolveDialect("sqlite"), sqliteDialect);
  assert.equal(resolveDialect("sqlite3"), sqliteDialect);
  assert.equal(resolveDialect("libsql"), sqliteDialect);
  assert.equal(resolveDialect("turso"), sqliteDialect);
});

test("SQLite dialect exposes phase 2 metadata and identifier formatting", () => {
  assert.equal(sqliteDialect.name, "sqlite");
  assert.equal(sqliteDialect.supportsTransactionalDDL, true);
  assert.equal(sqliteDialect.quoteIdentifier('we"ird'), '"we""ird"');
  assert.equal(sqliteDialect.schemaQualified("ignored", "users"), '"users"');
  assert.equal(sqliteDialect.formatDefault(true), "1");
});
