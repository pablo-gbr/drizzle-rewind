import assert from "node:assert/strict";
import { test } from "node:test";

import { diffSnapshots } from "../src/diff";
import { emptySnapshot, type Snapshot, type TableDef } from "../src/snapshot";

function table(name: string, over: Partial<TableDef> = {}): TableDef {
  return {
    name,
    schema: "public",
    columns: {},
    indexes: {},
    foreignKeys: {},
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {},
    isRLSEnabled: false,
    ...over,
  };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot(), ...over };
}

const idCol = {
  id: { name: "id", type: "uuid", primaryKey: true, notNull: true },
};

test("a table added since the previous snapshot is dropped", () => {
  const { statements } = diffSnapshots(
    snap({ tables: { "public.users": table("users", { columns: idCol }) } }),
    snap(),
  );
  assert.ok(
    statements.some((s) => s.startsWith('DROP TABLE IF EXISTS "public"."users"')),
    "expected a DROP TABLE for the added table",
  );
});

test("a dropped column is restored, and the data loss is flagged", () => {
  const previous = snap({
    tables: {
      "public.users": table("users", {
        columns: {
          ...idCol,
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
      }),
    },
  });
  const current = snap({
    tables: { "public.users": table("users", { columns: idCol }) },
  });

  const { statements, warnings } = diffSnapshots(current, previous);

  assert.ok(
    statements.some((s) => s.includes('ADD COLUMN "email" text')),
    "expected the dropped column to be re-added",
  );
  assert.ok(
    warnings.some((w) => w.includes("cannot be recovered")),
    "expected a data-loss warning",
  );
});

test("indexes are dropped before the columns they reference", () => {
  const withIndex = table("users", {
    columns: {
      ...idCol,
      email: { name: "email", type: "text", primaryKey: false, notNull: false },
    },
    indexes: {
      users_email_idx: {
        name: "users_email_idx",
        columns: [
          { expression: "email", isExpression: false, asc: true, nulls: "last" },
        ],
        isUnique: false,
        concurrently: false,
        method: "btree",
        with: {},
      },
    },
  });

  const { statements } = diffSnapshots(
    snap({ tables: { "public.users": withIndex } }),
    snap({ tables: { "public.users": table("users", { columns: idCol }) } }),
  );

  const dropIndex = statements.findIndex((s) => s.startsWith("DROP INDEX"));
  const dropColumn = statements.findIndex((s) => s.includes('DROP COLUMN "email"'));

  assert.notEqual(dropIndex, -1, "expected a DROP INDEX");
  assert.notEqual(dropColumn, -1, "expected a DROP COLUMN");
  assert.ok(dropIndex < dropColumn, "DROP INDEX must come before DROP COLUMN");
});

test("an added enum value warns instead of emitting fake SQL", () => {
  const { statements, warnings } = diffSnapshots(
    snap({
      enums: {
        "public.role": { name: "role", schema: "public", values: ["admin", "user", "guest"] },
      },
    }),
    snap({
      enums: {
        "public.role": { name: "role", schema: "public", values: ["admin", "user"] },
      },
    }),
  );

  assert.equal(statements.length, 0, "must not invent SQL for an irreversible change");
  assert.ok(
    warnings.some((w) => w.includes("guest") && w.includes("cannot remove enum values")),
    "expected an enum warning naming the added value",
  );
});

test("identical snapshots produce nothing", () => {
  const s = snap({ tables: { "public.users": table("users", { columns: idCol }) } });
  const { statements, warnings } = diffSnapshots(s, s);
  assert.deepEqual(statements, []);
  assert.deepEqual(warnings, []);
});
