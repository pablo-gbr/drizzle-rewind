import type {
  ForeignKeyDef,
  IndexColumn,
  IndexDef,
  Snapshot,
  UniqueConstraintDef,
} from "./snapshot";

export interface MySqlForwardNames {
  indexes: Map<string, string>;
  foreignKeys: Map<string, string>;
  uniqueConstraints: Map<string, string>;
}

export function emptyMySqlForwardNames(): MySqlForwardNames {
  return {
    indexes: new Map(),
    foreignKeys: new Map(),
    uniqueConstraints: new Map(),
  };
}

export function parseMySqlForwardNames(sql: string): MySqlForwardNames {
  const names = emptyMySqlForwardNames();
  const statements = sql
    .split(/-->\s*statement-breakpoint|;/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    // ponytail: regex SQL parsing handles Drizzle-style DDL only; use a parser if
    // hand-written migrations get more creative than ALTER/CREATE index clauses.
    const fk = statement.match(
      /ALTER\s+TABLE\s+(`[^`]+`|\w+)\s+ADD\s+CONSTRAINT\s+(`[^`]+`|\w+)\s+FOREIGN\s+KEY\s*\(([^)]*)\)/i,
    );
    if (fk) {
      names.foreignKeys.set(aliasKey(readIdent(fk[1]), readColumns(fk[3])), readIdent(fk[2]));
      continue;
    }

    const uniqueConstraint = statement.match(
      /ALTER\s+TABLE\s+(`[^`]+`|\w+)\s+ADD\s+CONSTRAINT\s+(`[^`]+`|\w+)\s+UNIQUE\s*\(([^)]*)\)/i,
    );
    if (uniqueConstraint) {
      const key = aliasKey(readIdent(uniqueConstraint[1]), readColumns(uniqueConstraint[3]));
      names.uniqueConstraints.set(key, readIdent(uniqueConstraint[2]));
      names.indexes.set(key, readIdent(uniqueConstraint[2]));
      continue;
    }

    const createIndex = statement.match(
      /CREATE\s+(UNIQUE\s+)?INDEX\s+(`[^`]+`|\w+)\s+ON\s+(`[^`]+`|\w+)\s*\(([^)]*)\)/i,
    );
    if (createIndex) {
      const key = aliasKey(readIdent(createIndex[3]), readColumns(createIndex[4]));
      names.indexes.set(key, readIdent(createIndex[2]));
      if (createIndex[1]) names.uniqueConstraints.set(key, readIdent(createIndex[2]));
      continue;
    }

    const alterIndex = statement.match(
      /ALTER\s+TABLE\s+(`[^`]+`|\w+)\s+ADD\s+(UNIQUE\s+)?(?:INDEX|KEY)\s+(`[^`]+`|\w+)\s*\(([^)]*)\)/i,
    );
    if (alterIndex) {
      const key = aliasKey(readIdent(alterIndex[1]), readColumns(alterIndex[4]));
      names.indexes.set(key, readIdent(alterIndex[3]));
      if (alterIndex[2]) names.uniqueConstraints.set(key, readIdent(alterIndex[3]));
    }
  }

  return names;
}

export function mergeMySqlForwardNames(parts: MySqlForwardNames[]): MySqlForwardNames {
  const merged = emptyMySqlForwardNames();
  for (const part of parts) {
    for (const [key, value] of part.indexes) merged.indexes.set(key, value);
    for (const [key, value] of part.foreignKeys) merged.foreignKeys.set(key, value);
    for (const [key, value] of part.uniqueConstraints) {
      merged.uniqueConstraints.set(key, value);
    }
  }
  return merged;
}

export function applyMySqlForwardNames(
  snapshot: Snapshot,
  names: MySqlForwardNames,
): Snapshot {
  const next = structuredClone(snapshot) as Snapshot;

  for (const table of Object.values(next.tables ?? {})) {
    for (const idx of Object.values(table.indexes ?? {})) {
      const actualName = names.indexes.get(aliasKey(table.name, indexColumns(idx)));
      if (actualName) idx.name = actualName;
    }

    for (const fk of Object.values(table.foreignKeys ?? {})) {
      const actualName = names.foreignKeys.get(aliasKey(table.name, fk.columnsFrom));
      if (actualName) fk.name = actualName;
    }

    for (const uc of Object.values(table.uniqueConstraints ?? {})) {
      const actualName = names.uniqueConstraints.get(aliasKey(table.name, uc.columns));
      if (actualName) uc.name = actualName;
    }
  }

  return next;
}

function indexColumns(idx: IndexDef): string[] {
  return idx.columns.map((column) => {
    if (typeof column === "string") return column;
    const compat = column as IndexColumn & { name?: string };
    return compat.expression ?? compat.name ?? "";
  });
}

function aliasKey(table: string, columns: string[]): string {
  return `${table.toLowerCase()}:${columns.map((c) => c.toLowerCase()).join(",")}`;
}

function readColumns(columnsSql: string): string[] {
  return columnsSql.split(",").map((c) => readIdent(c.trim().split(/\s+/)[0] ?? ""));
}

function readIdent(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1).replace(/``/g, "`")
    : trimmed;
}
