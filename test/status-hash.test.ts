import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { findHashMismatches } from "../src/commands/status";
import { migrationHash, type JournalEntry } from "../src/journal";

const entry: JournalEntry = {
  idx: 1,
  version: "7",
  when: 1770000001000,
  tag: "0001_add_user",
  breakpoints: true,
};

test("migrationHash returns the sha256 of a migration file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-rewind-hash-"));
  const file = path.join(dir, `${entry.tag}.sql`);
  fs.writeFileSync(file, "CREATE TABLE users (id integer);\n");

  assert.equal(
    migrationHash(file),
    "3ae90ecc4d506cda0dc3961d0aa61703075387b62bc1cb1b1ec237f591eb3b60",
  );
});

test("findHashMismatches compares applied database rows with migration files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-rewind-status-"));
  const file = path.join(dir, `${entry.tag}.sql`);
  fs.writeFileSync(file, "CREATE TABLE users (id integer);\n");
  const hash = migrationHash(file);

  assert.deepEqual(
    findHashMismatches(dir, [entry], [
      { id: 1, hash, created_at: String(entry.when) },
    ]),
    [],
  );

  const mismatches = findHashMismatches(dir, [entry], [
    { id: 1, hash: "not-the-same", created_at: String(entry.when) },
  ]);

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].entry, entry);
  assert.equal(mismatches[0].actual, "not-the-same");
  assert.equal(mismatches[0].expected, hash);
});
