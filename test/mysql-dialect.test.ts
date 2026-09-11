import assert from "node:assert/strict";
import { test } from "node:test";

import { diffSnapshots } from "../src/diff";
import { mysqlDialect } from "../src/dialects/mysql";
import { emptySnapshot, type Snapshot, type TableDef } from "../src/snapshot";

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
  return { ...emptySnapshot(), dialect: "mysql", ...over };
}

test("quotes MariaDB identifiers with escaped backticks", () => {
  assert.equal(mysqlDialect.quoteIdentifier("users"), "`users`");
  assert.equal(mysqlDialect.quoteIdentifier("select"), "`select`");
  assert.equal(mysqlDialect.quoteIdentifier("we`ird"), "`we``ird`");
});

test("renders MariaDB add and drop column SQL", () => {
  const users = table("users");

  assert.equal(
    mysqlDialect.generateAddColumn(users, {
      name: "nickname",
      type: "varchar(100)",
      primaryKey: false,
      notNull: false,
      default: "'guest'",
    }),
    "ALTER TABLE `users` ADD COLUMN `nickname` varchar(100) NULL DEFAULT 'guest'",
  );
  assert.equal(
    mysqlDialect.generateDropColumn(users, "nickname"),
    "ALTER TABLE `users` DROP COLUMN `nickname`",
  );
});

test("renders MariaDB MODIFY COLUMN with full previous definition", () => {
  const current = snap({
    tables: {
      users: table("users", {
        columns: {
          id: {
            name: "id",
            type: "int",
            primaryKey: true,
            notNull: true,
            autoIncrement: true,
          },
          email: {
            name: "email",
            type: "varchar(320)",
            primaryKey: false,
            notNull: false,
          },
        },
      }),
    },
  });
  const previous = snap({
    tables: {
      users: table("users", {
        columns: {
          id: {
            name: "id",
            type: "int",
            primaryKey: true,
            notNull: true,
            autoIncrement: true,
          },
          email: {
            name: "email",
            type: "varchar(255)",
            primaryKey: false,
            notNull: true,
            default: "'unknown@example.com'",
          },
        },
      }),
    },
  });

  assert.deepEqual(diffSnapshots(current, previous, mysqlDialect).statements, [
    "ALTER TABLE `users` MODIFY COLUMN `email` varchar(255) NOT NULL DEFAULT 'unknown@example.com'",
  ]);
});

test("renders MariaDB foreign keys, primary keys, and indexes", () => {
  const child = table("child");

  assert.equal(
    mysqlDialect.generateAddFK(child, {
      name: "child_parent_id_fk",
      tableFrom: "child",
      tableTo: "parent",
      columnsFrom: ["parent_id"],
      columnsTo: ["id"],
      onDelete: "cascade",
      onUpdate: "no action",
    }),
    "ALTER TABLE `child` ADD CONSTRAINT `child_parent_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON DELETE cascade ON UPDATE no action",
  );
  assert.equal(
    mysqlDialect.generateDropForeignKey(child, "child_parent_id_fk"),
    "ALTER TABLE `child` DROP FOREIGN KEY `child_parent_id_fk`",
  );
  assert.equal(
    mysqlDialect.generateDropPrimaryKey(child, "child_pk"),
    "ALTER TABLE `child` DROP PRIMARY KEY",
  );
  assert.equal(
    mysqlDialect.generateCreateIndex(child, {
      name: "child_parent_id_idx",
      columns: [
        { expression: "parent_id", isExpression: false, asc: true, nulls: "last" },
        { expression: "created_at", isExpression: false, asc: false, nulls: "last" },
      ],
      isUnique: true,
      concurrently: false,
      method: "btree",
      with: {},
    }),
    "CREATE UNIQUE INDEX `child_parent_id_idx` ON `child` (`parent_id`, `created_at` DESC)",
  );
  assert.equal(
    mysqlDialect.generateDropIndex(child, "child_parent_id_idx"),
    "ALTER TABLE `child` DROP INDEX `child_parent_id_idx`",
  );
});

test("does not render standalone PostgreSQL enum SQL for MariaDB", () => {
  assert.throws(() =>
    mysqlDialect.generateCreateEnum({
      name: "role",
      schema: "",
      values: ["admin", "user"],
    }),
  );
});
