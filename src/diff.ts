import type { Snapshot } from "./snapshot";
import {
  generateAddColumn,
  generateAddCompositePK,
  generateAddFK,
  generateAddUnique,
  generateCreateEnum,
  generateCreateIndex,
  generateCreateTable,
  generateDropColumn,
  generateDropConstraint,
  generateDropDefault,
  generateDropEnum,
  generateDropIndex,
  generateDropNotNull,
  generateDropTable,
  generateSetColumnType,
  generateSetDefault,
  generateSetNotNull,
} from "./sql";

export interface DiffResult {
  statements: string[];
  warnings: string[];
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
export function diffSnapshots(current: Snapshot, previous: Snapshot): DiffResult {
  const statements: string[] = [];
  const warnings: string[] = [];

  const currentTables = current.tables;
  const previousTables = previous.tables;
  const currentEnums = current.enums;
  const previousEnums = previous.enums;

  // Phase 1: drop indexes that were added, before dropping columns they use
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [idxName, idx] of Object.entries(currentTable.indexes)) {
      if (!prevTable.indexes[idxName]) statements.push(generateDropIndex(idx.name));
    }
  }

  // Phase 2: drop foreign keys that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [fkName, fk] of Object.entries(currentTable.foreignKeys)) {
      if (!prevTable.foreignKeys[fkName]) {
        statements.push(generateDropConstraint(currentTable, fk.name));
      }
    }
  }

  // Phase 3: drop unique constraints that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [ucName, uc] of Object.entries(currentTable.uniqueConstraints)) {
      if (!prevTable.uniqueConstraints[ucName]) {
        statements.push(generateDropConstraint(currentTable, uc.name));
      }
    }
  }

  // Phase 4: composite primary key changes
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;
    for (const [pkName, pk] of Object.entries(currentTable.compositePrimaryKeys)) {
      if (!prevTable.compositePrimaryKeys[pkName]) {
        statements.push(generateDropConstraint(currentTable, pk.name));
      }
    }
    for (const [pkName, pk] of Object.entries(prevTable.compositePrimaryKeys)) {
      if (!currentTable.compositePrimaryKeys[pkName]) {
        statements.push(generateAddCompositePK(currentTable, pk));
      }
    }
  }

  // Phase 5: column add / drop / alter
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    const prevTable = previousTables[tableKey];
    if (!prevTable) continue;

    for (const [colName, col] of Object.entries(currentTable.columns)) {
      if (!prevTable.columns[colName]) {
        statements.push(generateDropColumn(currentTable, col.name));
      }
    }

    for (const [colName, prevCol] of Object.entries(prevTable.columns)) {
      if (!currentTable.columns[colName]) {
        statements.push(generateAddColumn(currentTable, prevCol));
        warnings.push(
          `Restoring column "${prevCol.name}" on "${currentTable.name}". Data from before the drop cannot be recovered.`,
        );
      }
    }

    for (const [colName, currentCol] of Object.entries(currentTable.columns)) {
      const prevCol = prevTable.columns[colName];
      if (!prevCol) continue;

      if (currentCol.type !== prevCol.type) {
        statements.push(
          generateSetColumnType(currentTable, currentCol.name, prevCol.type),
        );
      }

      if (currentCol.notNull !== prevCol.notNull) {
        statements.push(
          prevCol.notNull
            ? generateSetNotNull(currentTable, currentCol.name)
            : generateDropNotNull(currentTable, currentCol.name),
        );
      }

      if (JSON.stringify(currentCol.default) !== JSON.stringify(prevCol.default)) {
        const prevDefault = prevCol.default;
        statements.push(
          prevDefault !== undefined && prevDefault !== null
            ? generateSetDefault(currentTable, currentCol.name, prevDefault)
            : generateDropDefault(currentTable, currentCol.name),
        );
      }
    }
  }

  // Phase 6: drop tables that were added
  for (const [tableKey, currentTable] of Object.entries(currentTables)) {
    if (previousTables[tableKey]) continue;
    for (const fk of Object.values(currentTable.foreignKeys)) {
      statements.push(generateDropConstraint(currentTable, fk.name));
    }
    for (const idx of Object.values(currentTable.indexes)) {
      statements.push(generateDropIndex(idx.name));
    }
    statements.push(generateDropTable(currentTable));
  }

  // Phase 7: restore tables that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    if (currentTables[tableKey]) continue;
    statements.push(...generateCreateTable(prevTable));
    warnings.push(
      `Restoring table "${prevTable.name}". Data from before the drop cannot be recovered.`,
    );
  }

  // Phase 8: restore indexes that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [idxName, idx] of Object.entries(prevTable.indexes)) {
      if (!currentTable.indexes[idxName]) {
        statements.push(generateCreateIndex(prevTable, idx));
      }
    }
  }

  // Phase 9: restore foreign keys that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [fkName, fk] of Object.entries(prevTable.foreignKeys)) {
      if (!currentTable.foreignKeys[fkName]) {
        statements.push(generateAddFK(prevTable, fk));
      }
    }
  }

  // Phase 10: restore unique constraints that were removed
  for (const [tableKey, prevTable] of Object.entries(previousTables)) {
    const currentTable = currentTables[tableKey];
    if (!currentTable) continue;
    for (const [ucName, uc] of Object.entries(prevTable.uniqueConstraints)) {
      if (!currentTable.uniqueConstraints[ucName]) {
        statements.push(generateAddUnique(prevTable, uc));
      }
    }
  }

  // Phase 11: enum changes
  for (const [enumKey, e] of Object.entries(currentEnums)) {
    if (!previousEnums[enumKey]) statements.push(generateDropEnum(e));
  }
  for (const [enumKey, prevEnum] of Object.entries(previousEnums)) {
    if (!currentEnums[enumKey]) statements.push(generateCreateEnum(prevEnum));
  }
  for (const [enumKey, currentEnum] of Object.entries(currentEnums)) {
    const prevEnum = previousEnums[enumKey];
    if (!prevEnum) continue;
    const added = currentEnum.values.filter((v) => !prevEnum.values.includes(v));
    if (added.length > 0) {
      warnings.push(
        `Enum "${currentEnum.name}" gained values (${added.join(", ")}). PostgreSQL cannot remove enum values, so undoing this means recreating the type. That is NOT in the generated down.sql.`,
      );
    }
  }

  return { statements, warnings };
}
