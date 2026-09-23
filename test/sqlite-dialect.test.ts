import assert from "node:assert/strict";
import { test } from "node:test";

import { diffSnapshots } from "../src/diff";
import { UnsupportedDialectOperationError } from "../src/dialects/dialect";
import { SQLiteDialect, sqliteDialect } from "../src/dialects/sqlite";
import {
  emptySnapshot,
  type IndexColumn,
  type Snapshot,
  type TableDef,
} from "../src/snapshot";

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

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { ...emptySnapshot(), dialect: "sqlite", ...over };
}

test("renders SQLite identifiers and defaults", () => {
  assert.equal(sqliteDialect.quoteIdentifier("users"), '"users"');
  assert.equal(sqliteDialect.quoteIdentifier('we"ird'), '"we""ird"');
  assert.equal(sqliteDialect.schemaQualified("ignored", "users"), '"users"');
  assert.equal(sqliteDialect.formatDefault(true), "1");
  assert.equal(sqliteDialect.formatDefault(false), "0");
});

test("renders SQLite add column and drop table SQL", () => {
  const users = table("users");

  assert.equal(
    sqliteDialect.generateAddColumn(users, {
      name: "nickname",
      type: "text",
      primaryKey: false,
      notNull: false,
      default: "'guest'",
    }),
    'ALTER TABLE "users" ADD COLUMN "nickname" text DEFAULT \'guest\'',
  );
  assert.equal(
    sqliteDialect.generateDropTable(users),
    'DROP TABLE IF EXISTS "users"',
  );
});

test("renders SQLite create table with inline constraints", () => {
  const child = table("child", {
    columns: {
      id: {
        name: "id",
        type: "integer",
        primaryKey: true,
        notNull: true,
        autoincrement: true,
      },
      parent_id: {
        name: "parent_id",
        type: "integer",
        primaryKey: false,
        notNull: true,
      },
      slug: {
        name: "slug",
        type: "text",
        primaryKey: false,
        notNull: true,
      },
    },
    uniqueConstraints: {
      child_slug_unique: { name: "child_slug_unique", columns: ["slug"] },
    },
    foreignKeys: {
      child_parent_id_fk: {
        name: "child_parent_id_fk",
        tableFrom: "child",
        tableTo: "parent",
        columnsFrom: ["parent_id"],
        columnsTo: ["id"],
        onDelete: "cascade",
        onUpdate: "no action",
      },
    },
  });

  assert.deepEqual(sqliteDialect.generateCreateTable(child), [
    'CREATE TABLE IF NOT EXISTS "child" (\n\t"id" integer PRIMARY KEY NOT NULL AUTOINCREMENT,\n\t"parent_id" integer NOT NULL,\n\t"slug" text NOT NULL,\n\tCONSTRAINT "child_slug_unique" UNIQUE("slug"),\n\tCONSTRAINT "child_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "parent"("id") ON DELETE cascade ON UPDATE no action\n)',
  ]);
});

test("renders SQLite create and drop index SQL", () => {
  const users = table("users");

  assert.equal(
    sqliteDialect.generateCreateIndex(users, {
      name: "users_email_idx",
      columns: [
        { expression: "email", isExpression: false, asc: true, nulls: "last" },
        { expression: "created_at", isExpression: false, asc: false, nulls: "last" },
      ],
      isUnique: true,
      concurrently: false,
      method: "btree",
      with: {},
    }),
    'CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email", "created_at" DESC)',
  );
  assert.equal(
    sqliteDialect.generateDropIndex(users, "users_email_idx"),
    'DROP INDEX IF EXISTS "users_email_idx"',
  );
});

test("diffs SQLite simple rollback operations", () => {
  const current = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
        indexes: {
          users_email_idx: {
            name: "users_email_idx",
            columns: [
              { expression: "email", isExpression: false, asc: true, nulls: "last" },
            ] as IndexColumn[],
            isUnique: false,
            concurrently: false,
            method: "btree",
            with: {},
          },
        },
      }),
    },
  });
  const previous = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
      }),
    },
  });

  assert.deepEqual(diffSnapshots(current, previous, sqliteDialect).statements, [
    'DROP INDEX IF EXISTS "users_email_idx"',
  ]);
});

test("diffs SQLite restored table with indexes", () => {
  const previous = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
        indexes: {
          users_email_idx: {
            name: "users_email_idx",
            columns: [
              { expression: "email", isExpression: false, asc: true, nulls: "last" },
            ] as IndexColumn[],
            isUnique: true,
            concurrently: false,
            method: "btree",
            with: {},
          },
        },
      }),
    },
  });

  assert.deepEqual(diffSnapshots(snap(), previous, sqliteDialect).statements, [
    'CREATE TABLE IF NOT EXISTS "users" (\n\t"id" integer PRIMARY KEY NOT NULL,\n\t"email" text NOT NULL\n)',
    'CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email")',
  ]);
});

test("diffSnapshots surfaces typed SQLite unsupported operations", () => {
  const current = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
      }),
    },
  });
  const previous = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
        },
      }),
    },
  });

  assert.throws(() => diffSnapshots(current, previous, sqliteDialect), {
    name: "UnsupportedDialectOperationError",
    dialect: "sqlite",
    operation: "drop column requires table rebuild support",
  } as Partial<UnsupportedDialectOperationError>);
});

test("diffSnapshots emits SQLite table rebuild SQL when explicitly enabled", () => {
  const rebuildDialect = new SQLiteDialect(true);
  const current = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: true },
        },
        indexes: {
          users_email_idx: {
            name: "users_email_idx",
            columns: [
              { expression: "email", isExpression: false, asc: true, nulls: "last" },
            ] as IndexColumn[],
            isUnique: false,
            concurrently: false,
            method: "btree",
            with: {},
          },
        },
      }),
    },
  });
  const previous = snap({
    tables: {
      users: table("users", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
        },
      }),
    },
  });

  assert.deepEqual(diffSnapshots(current, previous, rebuildDialect).statements, [
    'DROP INDEX IF EXISTS "users_email_idx"',
    'CREATE TABLE IF NOT EXISTS "__drizzle_rewind_users" (\n\t"id" integer PRIMARY KEY NOT NULL\n)',
    'INSERT INTO "__drizzle_rewind_users" ("id") SELECT "id" FROM "users"',
    'DROP TABLE "users"',
    'ALTER TABLE "__drizzle_rewind_users" RENAME TO "users"',
  ]);
});

test("drops newly added SQLite table without standalone foreign key drops", () => {
  const current = snap({
    tables: {
      child: table("child", {
        columns: {
          id: { name: "id", type: "integer", primaryKey: true, notNull: true },
          parent_id: {
            name: "parent_id",
            type: "integer",
            primaryKey: false,
            notNull: true,
          },
        },
        foreignKeys: {
          child_parent_id_fk: {
            name: "child_parent_id_fk",
            tableFrom: "child",
            tableTo: "parent",
            columnsFrom: ["parent_id"],
            columnsTo: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        },
      }),
    },
  });

  assert.deepEqual(diffSnapshots(current, snap(), sqliteDialect).statements, [
    'DROP TABLE IF EXISTS "child"',
  ]);
});

test("throws clear errors for SQLite table-rebuild operations", () => {
  assert.throws(() => sqliteDialect.generateSetColumnType(table("users"), "email", "text"), {
    name: "UnsupportedDialectOperationError",
    dialect: "sqlite",
    operation: "changing column types requires table rebuild support",
  } as Partial<UnsupportedDialectOperationError>);
  assert.throws(() => sqliteDialect.generateDropForeignKey(table("users"), "users_parent_fk"), {
    name: "UnsupportedDialectOperationError",
    dialect: "sqlite",
    operation: "dropping foreign keys requires table rebuild support",
  } as Partial<UnsupportedDialectOperationError>);
});
