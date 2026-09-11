import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  buildRollbackPlan,
  splitSqlStatements,
} from "../src/commands/rollback-plan";
import { BREAKPOINT, type JournalEntry } from "../src/journal";

const entry: JournalEntry = {
  idx: 1,
  version: "7",
  when: 1770000001000,
  tag: "0001_add_user_nickname",
  breakpoints: true,
};

test("splits down SQL on Drizzle statement breakpoints", () => {
  assert.deepEqual(
    splitSqlStatements(`ALTER TABLE users DROP COLUMN nickname;${BREAKPOINT}\nDROP INDEX users_email_idx;`),
    [
      "ALTER TABLE users DROP COLUMN nickname",
      "DROP INDEX users_email_idx",
    ],
  );
});

test("builds rollback plan with statements and risk summary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-rewind-plan-"));
  fs.writeFileSync(
    path.join(dir, `${entry.tag}.down.sql`),
    [
      "-- WARNING: DATA-LOSS: users.nickname may remove values.",
      "",
      "ALTER TABLE `users` DROP COLUMN `nickname`;",
    ].join("\n"),
  );

  const plan = buildRollbackPlan(dir, "mysql", [entry], "0000_create_users");

  assert.equal(plan.dialect, "mysql");
  assert.equal(plan.from, entry.tag);
  assert.equal(plan.to, "0000_create_users");
  assert.deepEqual(plan.summary, {
    safe: 0,
    "data-loss": 1,
    "irreversible-data-loss": 0,
    unsupported: 0,
  });
  assert.equal(plan.statements.length, 1);
  assert.match(plan.statements[0], /DROP COLUMN/);
});
