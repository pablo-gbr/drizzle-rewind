import type { Snapshot } from "./snapshot";
import type { SqlDialect } from "./dialects/dialect";
import { postgresDialect } from "./dialects/postgres";
import { classifyRollbackOperation } from "./safety/classify";
import type { RollbackWarning } from "./safety/types";

export interface DiffResult {
  statements: string[];
  warnings: string[];
  riskWarnings: RollbackWarning[];
}

/**
 * Produce the SQL that turns `current` back into `previous`.
 *
 * Order matters and is the whole point of the phase split: indexes and
 * constraints come off before the columns they reference, and go back on after
 * the tables they belong to exist again. Anything that cannot be undone (data
 * behind a dropped column, a removed enum value) is reported as a warning
 * rather than faked.
 */
export function diffSnapshots(
  current: Snapshot,
  previous: Snapshot,
  dialect: SqlDialect = postgresDialect,
): DiffResult {
  const statements: string[] = [];
  const warnings: string[] = [];
  const riskWarnings: RollbackWarning[] = [];

  function record(
    operation: string,
    table?: string,
    column?: string,
  ): void {
    const warning = classifyRollbackOperation({ operation, table, column });
    riskWarnings.push(warning);
    if (warning.level !== "safe") warnings.push(warning.message);
  }

  const currentTables = current.tables ?? {};
  const previousTables = previous.tables ?? {};
  const currentEnums = current.enums ?? {};
  const previousEnums = previous.enums ?? {};

  // Phase 1: drop indexes that were added, before dropping columns they use
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [idxName, idx] of Object.entries(currentTable.indexes ?? {})) {
      if (!(prevTable.indexes ?? {})[idxName]) {
        statements.push(dialect.generateDropIndex(currentTable, idx.name));
        record("drop-index", currentTable.name);
      }
    }
  }

  // Phase 2: drop foreign keys that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [fkName, fk] of Object.entries(currentTable.foreignKeys ?? {})) {
      if (!(prevTable.foreignKeys ?? {})[fkName]) {
        statements.push(dialect.generateDropForeignKey(currentTable, fk.name));
        record("drop-foreign-key", currentTable.name);
      }
    }
  }

  // Phase 3: drop unique constraints that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [ucName, uc] of Object.entries(currentTable.uniqueConstraints ?? {})) {
      if (!(prevTable.uniqueConstraints ?? {})[ucName]) {
        statements.push(dialect.generateDropUnique(currentTable, uc.name));
        record("drop-unique-constraint", currentTable.name);
      }
    }
  }

  // Phase 4: composite primary key changes
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [pkName, pk] of Object.entries(currentTable.compositePrimaryKeys ?? {})) {
      if (!(prevTable.compositePrimaryKeys ?? {})[pkName]) {
        statements.push(dialect.generateDropPrimaryKey(currentTable, pk.name));
        record("drop-primary-key", currentTable.name);
      }
    }
    for (const [pkName, pk] of Object.entries(prevTable.compositePrimaryKeys ?? {})) {
      if (!(currentTable.compositePrimaryKeys ?? {})[pkName]) {
        statements.push(dialect.generateAddCompositePK(currentTable, pk));
        record("add-primary-key", currentTable.name);
      }
    }
  }

  // Phase 5: column add / drop / alter
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;

    for (const [colName, col] of Object.entries(currentTable.columns ?? {})) {
      if (!(prevTable.columns ?? {})[colName]) {
        statements.push(dialect.generateDropColumn(currentTable, col.name));
        record("drop-column", currentTable.name, col.name);
      }
    }

    for (const [colName, prevCol] of Object.entries(prevTable.columns ?? {})) {
      if (!(currentTable.columns ?? {})[colName]) {
        statements.push(dialect.generateAddColumn(currentTable, prevCol));
        record("restore-column", currentTable.name, prevCol.name);
      }
    }

    for (const [colName, currentCol] of Object.entries(currentTable.columns ?? {})) {
      const prevCol = (prevTable.columns ?? {})[colName];
      if (!prevCol) continue;

      const typeChanged = currentCol.type !== prevCol.type;
      const nullabilityChanged = currentCol.notNull !== prevCol.notNull;
      const defaultChanged =
        JSON.stringify(currentCol.default) !== JSON.stringify(prevCol.default);

      if (dialect.name === "mysql" && (typeChanged || nullabilityChanged || defaultChanged)) {
        statements.push(...dialect.generateModifyColumn(currentTable, prevCol));
        record("modify-column", currentTable.name, prevCol.name);
        continue;
      }

      if (typeChanged) {
        statements.push(
          dialect.generateSetColumnType(currentTable, currentCol.name, prevCol.type),
        );
        record("modify-column", currentTable.name, currentCol.name);
      }

      if (nullabilityChanged) {
        statements.push(
          prevCol.notNull
            ? dialect.generateSetNotNull(currentTable, currentCol.name)
            : dialect.generateDropNotNull(currentTable, currentCol.name),
        );
        record(
          prevCol.notNull ? "set-not-null" : "drop-not-null",
          currentTable.name,
          currentCol.name,
        );
      }

      if (defaultChanged) {
        const prevDefault = prevCol.default;
        statements.push(
          prevDefault !== undefined && prevDefault !== null
            ? dialect.generateSetDefault(currentTable, currentCol.name, prevDefault)
            : dialect.generateDropDefault(currentTable, currentCol.name),
        );
        record(
          prevDefault !== undefined && prevDefault !== null
            ? "set-default"
            : "drop-default",
          currentTable.name,
          currentCol.name,
        );
      }
    }
  }

  // Phase 6: drop tables that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    if (previousTables[tableKey]) continue;
    for (const fk of Object.values(currentTable.foreignKeys ?? {})) {
      statements.push(dialect.generateDropForeignKey(currentTable, fk.name));
      record("drop-foreign-key", currentTable.name);
    }
    for (const idx of Object.values(currentTable.indexes ?? {})) {
      statements.push(dialect.generateDropIndex(currentTable, idx.name));
      record("drop-index", currentTable.name);
    }
    statements.push(dialect.generateDropTable(currentTable));
    record("drop-table", currentTable.name);
  }

  // Phase 7: restore tables that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    if (currentTables[tableKey]) continue;
    statements.push(...dialect.generateCreateTable(prevTable));
    record("restore-table", prevTable.name);
  }

  // Phase 8: restore indexes that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [idxName, idx] of Object.entries(prevTable.indexes ?? {})) {
      if (!(currentTable.indexes ?? {})[idxName]) {
        statements.push(dialect.generateCreateIndex(prevTable, idx));
        record("add-index", prevTable.name);
      }
    }
  }

  // Phase 9: restore foreign keys that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [fkName, fk] of Object.entries(prevTable.foreignKeys ?? {})) {
      if (!(currentTable.foreignKeys ?? {})[fkName]) {
        statements.push(dialect.generateAddFK(prevTable, fk));
        record("add-foreign-key", prevTable.name);
      }
    }
  }

  // Phase 10: restore unique constraints that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [ucName, uc] of Object.entries(prevTable.uniqueConstraints ?? {})) {
      if (!(currentTable.uniqueConstraints ?? {})[ucName]) {
        statements.push(dialect.generateAddUnique(prevTable, uc));
        record("add-unique-constraint", prevTable.name);
      }
    }
  }

  // Phase 11: enum changes
  for (const [enumKey, e] of Object.entries(currentEnums)) {
    if (!previousEnums[enumKey]) {
      statements.push(dialect.generateDropEnum(e));
      record("drop-enum", e.name);
    }
  }
  for (const [enumKey, prevEnum] of Object.entries(previousEnums)) {
    if (!currentEnums[enumKey]) {
      statements.push(dialect.generateCreateEnum(prevEnum));
      record("restore-enum", prevEnum.name);
    }
  }
  for (const [enumKey, currentEnum] of Object.entries(currentEnums)) {
    const prevEnum = previousEnums[enumKey];
    if (!prevEnum) continue;
    const added = currentEnum.values.filter((v) => !prevEnum.values.includes(v));
    if (added.length > 0) {
      record("enum-added-values", currentEnum.name, added.join(", "));
    }
  }

  return { statements, warnings, riskWarnings };
}
