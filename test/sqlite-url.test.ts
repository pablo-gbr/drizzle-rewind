import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { parseSqliteDatabaseUrl } from "../src/db/sqlite-url";

test("parses supported SQLite local file locations", () => {
  assert.equal(
    parseSqliteDatabaseUrl("sqlite:./dev.db"),
    path.resolve("./dev.db"),
  );
  assert.equal(
    parseSqliteDatabaseUrl("file:./dev.db"),
    path.resolve("./dev.db"),
  );
  assert.equal(parseSqliteDatabaseUrl("./dev.db"), path.resolve("./dev.db"));
});

test("parses sqlite triple-slash local paths", () => {
  assert.equal(
    parseSqliteDatabaseUrl("sqlite:///tmp/dev.db"),
    path.resolve("/tmp/dev.db"),
  );
});

test("accepts libSQL and Turso-compatible remote SQLite locations", () => {
  const urls = [
    "libsql://example.turso.io",
    "turso://example",
    "https://example.com/db",
    "wss://example.com/db",
  ];

  for (const url of urls) {
    assert.equal(parseSqliteDatabaseUrl(url), url);
  }
});

test("rejects in-memory SQLite locations for rollback commands", () => {
  assert.throws(
    () => parseSqliteDatabaseUrl(":memory:"),
    /In-memory SQLite databases are not useful/,
  );
  assert.throws(
    () => parseSqliteDatabaseUrl("file::memory:"),
    /In-memory SQLite databases are not useful/,
  );
});
