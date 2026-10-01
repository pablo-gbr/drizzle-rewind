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

function snapshot(id: string, tables: Snapshot["tables"]): Snapshot {
  return {
    id,
    prevId: "",
    version: "7",
    dialect: "postgresql",
    tables,
    enums: {},
    schemas: {},
    _meta: { columns: {}, schemas: {}, tables: {} },
  };
}

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-rewind-check-"));
  const meta = path.join(dir, "meta");
  fs.mkdirSync(meta);
  fs.writeFileSync(
    path.join(meta, "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
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
        "public.users": table("users", {
          columns: {
            id: { name: "id", type: "uuid", primaryKey: true, notNull: true },
          },
        }),
      }),
    ),
  );
  fs.writeFileSync(
    path.join(meta, "0001_snapshot.json"),
    JSON.stringify(
      snapshot("add-email", {
        "public.users": table("users", {
          columns: {
            id: { name: "id", type: "uuid", primaryKey: true, notNull: true },
            email: { name: "email", type: "text", primaryKey: false, notNull: false },
          },
        }),
      }),
    ),
  );
  return dir;
}

function withQuietConsole(fn: () => void): void {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

function assertExit(code: number, fn: () => void): void {
  const exit = process.exit;
  process.exit = ((actual?: number) => {
    throw new Error(`exit:${actual}`);
  }) as typeof process.exit;
  try {
    assert.throws(fn, new RegExp(`exit:${code}`));
  } finally {
    process.exit = exit;
  }
}

test("generate --check fails when a down migration is missing", () => {
  const dir = fixture();

  withQuietConsole(() => {
    assertExit(EXIT.MIGRATION_STATE_MISMATCH, () =>
      generate(dir, ["--idx", "1", "--check"]),
    );
  });
});

test("generate --check fails when a down migration is stale", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, "0001_add_email.down.sql"), "select 1;\n");

  withQuietConsole(() => {
    assertExit(EXIT.MIGRATION_STATE_MISMATCH, () =>
      generate(dir, ["--idx", "1", "--check"]),
    );
  });
});

test("generate --check passes when a down migration matches generated SQL", () => {
  const dir = fixture();

  withQuietConsole(() => {
    generate(dir, ["--idx", "1"]);
    generate(dir, ["--idx", "1", "--check"]);
  });
});
