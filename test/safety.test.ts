import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRollbackAllowed,
  classifyRollbackOperation,
  summarizeWarnings,
} from "../src/safety/classify";
import { classifySqlWarnings } from "../src/safety/sql";

test("classifies safe rollback operations", () => {
  const warning = classifyRollbackOperation({
    operation: "drop-index",
    table: "users",
  });

  assert.equal(warning.level, "safe");
});

test("classifies data-loss rollback operations", () => {
  const warning = classifyRollbackOperation({
    operation: "drop-column",
    table: "users",
    column: "nickname",
  });

  assert.equal(warning.level, "data-loss");
  assert.match(warning.message, /DATA LOSS/);
});

test("classifies irreversible data-loss rollback operations", () => {
  const warning = classifyRollbackOperation({
    operation: "restore-column",
    table: "users",
    column: "legacy_code",
  });

  assert.equal(warning.level, "irreversible-data-loss");
  assert.match(warning.message, /IRREVERSIBLE DATA LOSS/);
});

test("classifies unsupported rollback operations and summarizes risks", () => {
  const warnings = [
    classifyRollbackOperation({ operation: "drop-index" }),
    classifyRollbackOperation({ operation: "drop-column" }),
    classifyRollbackOperation({ operation: "restore-column" }),
    classifyRollbackOperation({ operation: "unknown-operation" }),
  ];

  assert.deepEqual(summarizeWarnings(warnings), {
    safe: 1,
    "data-loss": 1,
    "irreversible-data-loss": 1,
    unsupported: 1,
  });
});

test("guard blocks destructive rollback without acknowledgement", () => {
  const warnings = [
    classifyRollbackOperation({
      operation: "drop-table",
      table: "users",
    }),
  ];

  assert.throws(() => assertRollbackAllowed(warnings, {}), /allow-data-loss/);
  assert.doesNotThrow(() =>
    assertRollbackAllowed(warnings, { allowDataLoss: true }),
  );
});

test("irreversible acknowledgement also permits data-loss warnings", () => {
  const warnings = [
    classifyRollbackOperation({ operation: "drop-column" }),
    classifyRollbackOperation({ operation: "restore-column" }),
  ];

  assert.throws(() =>
    assertRollbackAllowed(warnings, { allowDataLoss: true }),
  );
  assert.doesNotThrow(() =>
    assertRollbackAllowed(warnings, { allowIrreversibleDataLoss: true }),
  );
});

test("SQL scanner detects destructive generated files", () => {
  const warnings = classifySqlWarnings(
    '-- WARNING: IRREVERSIBLE-DATA-LOSS: example\nALTER TABLE "users" DROP COLUMN "nickname";',
  );

  assert.ok(warnings.some((w) => w.level === "irreversible-data-loss"));
  assert.ok(warnings.some((w) => w.level === "data-loss"));
});
