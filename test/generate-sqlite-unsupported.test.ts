import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { generate } from "../src/commands/generate";
import { EXIT } from "../src/exit-codes";
import type { Snapshot, TableDef } from "../src/snapshot";

function table(name: string, over: Partial<TableDef> = {}): TableDef {
  return {
    name,
    schema: "",
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

function snapshot(id: string, tables: Snapshot["tables"]): Snapshot {
  return {
    id,
    prevId: "",
    version: "7",
    dialect: "sqlite",
    tables,
    enums: {},
    schemas: {},
    _meta: { columns: {}, schemas: {}, tables: {} },
  };
}

test("generate maps unsupported SQLite dialect operations to exit code 3", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-rewind-sqlite-"));
  const meta = path.join(dir, "meta");
  fs.mkdirSync(meta);
  fs.writeFileSync(
    path.join(meta, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "7", when: 1, tag: "0000_base", breakpoints: true },
        { idx: 1, version: "7", when: 2, tag: "0001_add_email", breakpoints: true },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(meta, "0000_snapshot.json"),
    JSON.stringify(
      snapshot("base", {
        users: table("users", {
          columns: {
            id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          },
        }),
      }),
    ),
  );
  fs.writeFileSync(
    path.join(meta, "0001_snapshot.json"),
    JSON.stringify(
      snapshot("add-email", {
        users: table("users", {
          columns: {
            id: { name: "id", type: "integer", primaryKey: true, notNull: true },
            email: { name: "email", type: "text", primaryKey: false, notNull: false },
          },
        }),
      }),
    ),
  );

  const exit = process.exit;
  const error = console.error;
  const log = console.log;
  const errors: string[] = [];
  process.exit = ((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as typeof process.exit;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.log = () => {};
  try {
    assert.throws(
      () => generate(dir, ["--dialect", "sqlite", "--idx", "1"]),
      /exit:3/,
    );
  } finally {
    process.exit = exit;
    console.error = error;
    console.log = log;
  }

  assert.equal(errors.some((line) => line.includes(`exit:${EXIT.UNSUPPORTED}`)), false);
  assert.ok(
    errors.some((line) =>
      line.includes("Unsupported sqlite rollback operation in 0001_add_email"),
    ),
  );
  assert.ok(errors.some((line) => line.includes("drop column requires table rebuild")));
});
