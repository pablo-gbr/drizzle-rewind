import assert from "node:assert/strict";
import { test } from "node:test";

import { diffSnapshots } from "../src/diff";
import { mysqlDialect } from "../src/dialects/mysql";
import {
  applyMySqlForwardNames,
  parseMySqlForwardNames,
} from "../src/mysql-forward-names";
import {
  emptySnapshot,
  type IndexColumn,
  type IndexDef,
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

test("diffs Drizzle MySQL indexes that keep names in snapshot keys", () => {
  const current = snap({
    tables: {
      alpha_records: table("alpha_records", {
        columns: {
          id: { name: "id", type: "int", primaryKey: true, notNull: true },
          group_id: {
            name: "group_id",
            type: "int",
            primaryKey: false,
            notNull: true,
          },
          sequence_no: { name: "sequence_no", type: "int", primaryKey: false, notNull: true },
        },
        indexes: {
          alpha_records_group_sequence_unique: {
            columns: [
              { name: "group_id", isExpression: false, asc: true, nulls: "last" },
              { name: "sequence_no", isExpression: false, asc: true, nulls: "last" },
            ] as unknown as IndexColumn[],
            isUnique: true,
            concurrently: false,
            method: "btree",
            with: {},
          } as unknown as IndexDef,
        },
      }),
    },
  } as unknown as Snapshot);
  const previous = snap({
    tables: {
      alpha_records: table("alpha_records", {
        columns: current.tables.alpha_records.columns,
        indexes: {},
      }),
    },
  });

  assert.deepEqual(diffSnapshots(current, previous, mysqlDialect).statements, [
    "ALTER TABLE `alpha_records` DROP INDEX `alpha_records_group_sequence_unique`",
  ]);
});

test("uses shortened MySQL names from forward SQL when snapshots keep long names", () => {
  const current = snap({
    tables: {
      alpha_event_messages: table("alpha_event_messages", {
        columns: {
          id: { name: "id", type: "int", primaryKey: true, notNull: true },
          source_entity_id: {
            name: "source_entity_id",
            type: "int",
            primaryKey: false,
            notNull: true,
          },
        },
        foreignKeys: {
          alpha_event_messages_source_entity_id_beta_entities_id_fk: {
            name: "alpha_event_messages_source_entity_id_beta_entities_id_fk",
            tableFrom: "alpha_event_messages",
            tableTo: "beta_entities",
            columnsFrom: ["source_entity_id"],
            columnsTo: ["id"],
            onDelete: "restrict",
            onUpdate: "cascade",
          },
        },
        indexes: {
          idx_alpha_event_messages_source_entity: {
            name: "idx_alpha_event_messages_source_entity",
            columns: ["source_entity_id"] as unknown as IndexColumn[],
            isUnique: false,
            concurrently: false,
            method: "btree",
            with: {},
          },
        },
      }),
    },
  } as unknown as Snapshot);
  const previous = snap({
    tables: {
      alpha_event_messages: table("alpha_event_messages", {
        columns: current.tables.alpha_event_messages.columns,
      }),
    },
  });
  const sql = "ALTER TABLE `alpha_event_messages` ADD CONSTRAINT `aem_source_beta_fk` FOREIGN KEY (`source_entity_id`) REFERENCES `beta_entities`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint\nALTER TABLE `alpha_event_messages` ADD INDEX `aem_source_idx` (`source_entity_id`);";
  const reconciled = applyMySqlForwardNames(current, parseMySqlForwardNames(sql));

  assert.deepEqual(diffSnapshots(reconciled, previous, mysqlDialect).statements, [
    "ALTER TABLE `alpha_event_messages` DROP INDEX `aem_source_idx`",
    "ALTER TABLE `alpha_event_messages` DROP FOREIGN KEY `aem_source_beta_fk`",
  ]);
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

test("diffs real Drizzle MySQL snapshots without enum or schema fields", () => {
  const current = {
    version: "5",
    dialect: "mysql",
    id: "current",
    prevId: "previous",
    tables: {
      users: table("users", {
        schema: undefined as unknown as string,
        columns: {
          id: {
            name: "id",
            type: "int",
            primaryKey: false,
            notNull: true,
            autoincrement: true,
          },
          name: {
            name: "name",
            type: "varchar(200)",
            primaryKey: false,
            notNull: true,
          },
          age: {
            name: "age",
            type: "int",
            primaryKey: false,
            notNull: true,
          },
        },
        compositePrimaryKeys: {
          users_id: { name: "users_id", columns: ["id"] },
        },
      }),
    },
    _meta: { columns: {}, schemas: {}, tables: {} },
  } as unknown as Snapshot;
  const previous = {
    ...current,
    id: "previous",
    prevId: "base",
    tables: {
      users: table("users", {
        schema: undefined as unknown as string,
        columns: {
          id: {
            name: "id",
            type: "int",
            primaryKey: false,
            notNull: true,
            autoincrement: true,
          },
          name: {
            name: "name",
            type: "varchar(200)",
            primaryKey: false,
            notNull: true,
          },
        },
        compositePrimaryKeys: {
          users_id: { name: "users_id", columns: ["id"] },
        },
      }),
    },
  } as unknown as Snapshot;

  assert.deepEqual(diffSnapshots(current, previous, mysqlDialect).statements, [
    "ALTER TABLE `users` DROP COLUMN `age`",
  ]);
});
