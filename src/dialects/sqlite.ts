import type {
  ColumnDef,
  CompositePKDef,
  EnumDef,
  ForeignKeyDef,
  IndexDef,
  TableDef,
  UniqueConstraintDef,
} from "../snapshot";
import type { SqlDialect } from "./dialect";
import { UnsupportedDialectOperationError } from "./dialect";

export class SQLiteDialect implements SqlDialect {
  readonly name = "sqlite";
  readonly supportsTransactionalDDL = true;

  constructor(readonly allowTableRebuild = false) {}

  quoteIdentifier(name: string): string {
    if (typeof name !== "string") {
      throw new Error("SQLite identifier is missing from the Drizzle snapshot.");
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  schemaQualified(_schema: string, name: string): string {
    return this.quoteIdentifier(name);
  }

  formatDefault(def: unknown): string {
    if (def === null || def === undefined) return "";
    if (typeof def === "boolean") return def ? "1" : "0";
    if (typeof def === "number") return def.toString();
    return String(def);
  }

  generateDropTable(table: TableDef): string {
    return `DROP TABLE IF EXISTS ${this.schemaQualified(table.schema, table.name)}`;
  }

  generateCreateTable(table: TableDef): string[] {
    const columnDefs = Object.values(table.columns).map(
      (col) => `\t${this.columnDefinition(col)}`,
    );

    for (const cpk of Object.values(table.compositePrimaryKeys ?? {})) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(cpk.name)} PRIMARY KEY(${cpk.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    for (const uc of Object.values(table.uniqueConstraints ?? {})) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(uc.name)} UNIQUE(${uc.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    for (const fk of Object.values(table.foreignKeys ?? {})) {
      columnDefs.push(`\t${this.foreignKeyDefinition(fk)}`);
    }

    const statements = [
      `CREATE TABLE IF NOT EXISTS ${this.schemaQualified(table.schema, table.name)} (\n${columnDefs.join(",\n")}\n)`,
    ];

    for (const idx of Object.values(table.indexes ?? {})) {
      statements.push(this.generateCreateIndex(table, idx));
    }

    return statements;
  }

  generateAddColumn(table: TableDef, col: ColumnDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD COLUMN ${this.columnDefinition(col)}`;
  }

  generateDropColumn(_table: TableDef, _colName: string): string {
    throw this.unsupported("drop column requires table rebuild support");
  }

  generateSetDefault(_table: TableDef, _colName: string, _defaultVal: unknown): string {
    throw this.unsupported("changing column defaults requires table rebuild support");
  }

  generateDropDefault(_table: TableDef, _colName: string): string {
    throw this.unsupported("changing column defaults requires table rebuild support");
  }

  generateSetNotNull(_table: TableDef, _colName: string): string {
    throw this.unsupported("changing column nullability requires table rebuild support");
  }

  generateDropNotNull(_table: TableDef, _colName: string): string {
    throw this.unsupported("changing column nullability requires table rebuild support");
  }

  generateSetColumnType(_table: TableDef, _colName: string, _type: string): string {
    throw this.unsupported("changing column types requires table rebuild support");
  }

  generateModifyColumn(_table: TableDef, _col: ColumnDef): string[] {
    throw this.unsupported("modifying columns requires table rebuild support");
  }

  generateCreateIndex(table: TableDef, idx: IndexDef): string {
    const unique = idx.isUnique ? "UNIQUE " : "";
    const colExprs = idx.columns
      .map((c) => {
        const expression =
          typeof c === "string"
            ? c
            : c.expression ?? ("name" in c ? String(c.name) : undefined);
        if (expression === undefined) {
          throw new Error(`Index ${idx.name} has a column without an expression/name.`);
        }
        const isExpression = typeof c !== "string" && c.isExpression;
        let expr = isExpression ? expression : this.quoteIdentifier(expression);
        if (!isExpression && typeof c !== "string" && c.asc === false) expr += " DESC";
        return expr;
      })
      .join(", ");

    return `CREATE ${unique}INDEX IF NOT EXISTS ${this.quoteIdentifier(idx.name)} ON ${this.schemaQualified(table.schema, table.name)} (${colExprs})`;
  }

  generateDropIndex(_table: TableDef, indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)}`;
  }

  generateAddFK(_table: TableDef, _fk: ForeignKeyDef): string {
    throw this.unsupported("adding foreign keys requires table rebuild support");
  }

  generateDropForeignKey(_table: TableDef, _constraintName: string): string {
    throw this.unsupported("dropping foreign keys requires table rebuild support");
  }

  generateAddCompositePK(_table: TableDef, _pk: CompositePKDef): string {
    throw this.unsupported("adding primary keys requires table rebuild support");
  }

  generateDropPrimaryKey(_table: TableDef, _pkName: string): string {
    throw this.unsupported("dropping primary keys requires table rebuild support");
  }

  generateAddUnique(_table: TableDef, _uc: UniqueConstraintDef): string {
    throw this.unsupported("adding unique constraints requires table rebuild support");
  }

  generateDropUnique(_table: TableDef, _constraintName: string): string {
    throw this.unsupported("dropping unique constraints requires table rebuild support");
  }

  generateCreateEnum(_e: EnumDef): string {
    throw this.unsupported("standalone enums are not supported");
  }

  generateDropEnum(_e: EnumDef): string {
    throw this.unsupported("standalone enums are not supported");
  }

  private unsupported(operation: string): Error {
    return new UnsupportedDialectOperationError(this.name, operation);
  }

  generateDropColumnRebuild(table: TableDef, colName: string): string[] {
    this.assertTableRebuild();
    const target = {
      ...table,
      columns: omitKey(table.columns ?? {}, colName),
      indexes: filterIndexes(table.indexes ?? {}, omitKey(table.columns ?? {}, colName)),
    };
    return this.generateRebuildTable(table, target);
  }

  generateAlterColumnRebuild(table: TableDef, col: ColumnDef): string[] {
    this.assertTableRebuild();
    return this.generateRebuildTable(table, {
      ...table,
      columns: { ...(table.columns ?? {}), [col.name]: col },
    });
  }

  generateDropForeignKeyRebuild(table: TableDef, constraintName: string): string[] {
    this.assertTableRebuild();
    return this.generateRebuildTable(table, {
      ...table,
      foreignKeys: omitKey(table.foreignKeys ?? {}, constraintName),
    });
  }

  generateDropPrimaryKeyRebuild(table: TableDef, pkName: string): string[] {
    this.assertTableRebuild();
    return this.generateRebuildTable(table, {
      ...table,
      compositePrimaryKeys: omitKey(table.compositePrimaryKeys ?? {}, pkName),
    });
  }

  generateDropUniqueRebuild(table: TableDef, constraintName: string): string[] {
    this.assertTableRebuild();
    return this.generateRebuildTable(table, {
      ...table,
      uniqueConstraints: omitKey(table.uniqueConstraints ?? {}, constraintName),
    });
  }

  generateRebuildTable(current: TableDef, target: TableDef): string[] {
    this.assertTableRebuild();
    const tempName = `__drizzle_rewind_${current.name}`;
    const tempTable = { ...target, name: tempName };
    const targetColumns = Object.keys(target.columns ?? {});
    const copiedColumns = targetColumns.filter((c) => (current.columns ?? {})[c]);
    if (targetColumns.length > 0 && copiedColumns.length === 0) {
      throw this.unsupported(`table rebuild for ${current.name} has no shared columns to copy`);
    }

    const statements = [
      this.createTableStatement(tempTable),
      `INSERT INTO ${this.quoteIdentifier(tempName)} (${copiedColumns.map((c) => this.quoteIdentifier(c)).join(", ")}) SELECT ${copiedColumns.map((c) => this.quoteIdentifier(c)).join(", ")} FROM ${this.schemaQualified(current.schema, current.name)}`,
      `DROP TABLE ${this.schemaQualified(current.schema, current.name)}`,
      `ALTER TABLE ${this.quoteIdentifier(tempName)} RENAME TO ${this.quoteIdentifier(target.name)}`,
    ];

    for (const idx of Object.values(target.indexes ?? {})) {
      statements.push(this.generateCreateIndex(target, idx));
    }

    return statements;
  }

  private assertTableRebuild(): void {
    if (!this.allowTableRebuild) {
      throw this.unsupported("table rebuild support is not enabled");
    }
  }

  private columnDefinition(col: ColumnDef): string {
    if (col.generated !== undefined) {
      throw this.unsupported(`generated column ${col.name}`);
    }

    let sql = `${this.quoteIdentifier(col.name)} ${col.type}`;
    if (col.primaryKey) sql += " PRIMARY KEY";
    if (col.notNull) sql += " NOT NULL";
    if (col.default !== undefined && col.default !== null) {
      sql += ` DEFAULT ${this.formatDefault(col.default)}`;
    }
    if (col.autoIncrement || col.autoincrement) sql += " AUTOINCREMENT";
    return sql;
  }

  private createTableStatement(table: TableDef): string {
    const columnDefs = Object.values(table.columns).map(
      (col) => `\t${this.columnDefinition(col)}`,
    );

    for (const cpk of Object.values(table.compositePrimaryKeys ?? {})) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(cpk.name)} PRIMARY KEY(${cpk.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    for (const uc of Object.values(table.uniqueConstraints ?? {})) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(uc.name)} UNIQUE(${uc.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    for (const fk of Object.values(table.foreignKeys ?? {})) {
      columnDefs.push(`\t${this.foreignKeyDefinition(fk)}`);
    }

    return `CREATE TABLE IF NOT EXISTS ${this.schemaQualified(table.schema, table.name)} (\n${columnDefs.join(",\n")}\n)`;
  }

  private foreignKeyDefinition(fk: ForeignKeyDef): string {
    const fromCols = fk.columnsFrom.map((c) => this.quoteIdentifier(c)).join(", ");
    const toCols = fk.columnsTo.map((c) => this.quoteIdentifier(c)).join(", ");
    let sql = `CONSTRAINT ${this.quoteIdentifier(fk.name)} FOREIGN KEY (${fromCols}) REFERENCES ${this.schemaQualified(fk.schemaTo || "", fk.tableTo)}(${toCols})`;
    if (fk.onDelete) sql += ` ON DELETE ${fk.onDelete}`;
    if (fk.onUpdate) sql += ` ON UPDATE ${fk.onUpdate}`;
    return sql;
  }
}

export const sqliteDialect = new SQLiteDialect();

function omitKey<T>(items: Record<string, T>, key: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [k, value] of Object.entries(items)) {
    if (k !== key && (value as { name?: string }).name !== key) next[k] = value;
  }
  return next;
}

function filterIndexes(
  indexes: Record<string, IndexDef>,
  columns: Record<string, ColumnDef>,
): Record<string, IndexDef> {
  const next: Record<string, IndexDef> = {};
  for (const [name, idx] of Object.entries(indexes)) {
    const usable = idx.columns.every((c) => {
      if (typeof c === "string") return Boolean(columns[c]);
      if (c.isExpression) return false;
      const columnName = c.expression ?? ("name" in c ? String(c.name) : undefined);
      return columnName !== undefined && Boolean(columns[columnName]);
    });
    if (usable) next[name] = idx;
  }
  return next;
}
