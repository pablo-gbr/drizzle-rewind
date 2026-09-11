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

export class PostgresDialect implements SqlDialect {
  readonly name = "postgres";
  readonly supportsTransactionalDDL = true;

  quoteIdentifier(name: string): string {
    return `"${name}"`;
  }

  schemaQualified(schema: string, name: string): string {
    return `${this.quoteIdentifier(schema || "public")}.${this.quoteIdentifier(name)}`;
  }

  formatDefault(def: unknown): string {
    if (def === null || def === undefined) return "";
    if (typeof def === "boolean") return def.toString();
    if (typeof def === "number") return def.toString();
    return String(def);
  }

  generateDropTable(table: TableDef): string {
    return `DROP TABLE IF EXISTS ${this.schemaQualified(table.schema, table.name)} CASCADE`;
  }

  generateCreateTable(table: TableDef): string[] {
    const statements: string[] = [];
    const columnDefs: string[] = [];

    for (const col of Object.values(table.columns)) {
      let colSql = `\t${this.quoteIdentifier(col.name)} ${col.type}`;
      if (col.primaryKey) colSql += " PRIMARY KEY";
      if (col.notNull) colSql += " NOT NULL";
      if (col.default !== undefined && col.default !== null) {
        colSql += ` DEFAULT ${this.formatDefault(col.default)}`;
      }
      columnDefs.push(colSql);
    }

    for (const cpk of Object.values(table.compositePrimaryKeys)) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(cpk.name)} PRIMARY KEY(${cpk.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    for (const uc of Object.values(table.uniqueConstraints)) {
      columnDefs.push(
        `\tCONSTRAINT ${this.quoteIdentifier(uc.name)} UNIQUE(${uc.columns.map((c) => this.quoteIdentifier(c)).join(",")})`,
      );
    }

    statements.push(
      `CREATE TABLE IF NOT EXISTS ${this.schemaQualified(table.schema, table.name)} (\n${columnDefs.join(",\n")}\n)`,
    );

    for (const fk of Object.values(table.foreignKeys)) {
      statements.push(this.generateAddFK(table, fk));
    }

    for (const idx of Object.values(table.indexes)) {
      statements.push(this.generateCreateIndex(table, idx));
    }

    return statements;
  }

  generateAddColumn(table: TableDef, col: ColumnDef): string {
    let sql = `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD COLUMN ${this.quoteIdentifier(col.name)} ${col.type}`;
    if (col.notNull) sql += " NOT NULL";
    if (col.default !== undefined && col.default !== null) {
      sql += ` DEFAULT ${this.formatDefault(col.default)}`;
    }
    return sql;
  }

  generateDropColumn(table: TableDef, colName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP COLUMN ${this.quoteIdentifier(colName)}`;
  }

  generateSetDefault(table: TableDef, colName: string, defaultVal: unknown): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ALTER COLUMN ${this.quoteIdentifier(colName)} SET DEFAULT ${this.formatDefault(defaultVal)}`;
  }

  generateDropDefault(table: TableDef, colName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ALTER COLUMN ${this.quoteIdentifier(colName)} DROP DEFAULT`;
  }

  generateSetNotNull(table: TableDef, colName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ALTER COLUMN ${this.quoteIdentifier(colName)} SET NOT NULL`;
  }

  generateDropNotNull(table: TableDef, colName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ALTER COLUMN ${this.quoteIdentifier(colName)} DROP NOT NULL`;
  }

  generateSetColumnType(table: TableDef, colName: string, type: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ALTER COLUMN ${this.quoteIdentifier(colName)} SET DATA TYPE ${type}`;
  }

  generateCreateIndex(table: TableDef, idx: IndexDef): string {
    const unique = idx.isUnique ? "UNIQUE " : "";
    const method = idx.method || "btree";

    const colExprs = idx.columns
      .map((c) => {
        let expr = c.isExpression ? c.expression : this.quoteIdentifier(c.expression);
        if (c.opclass) expr += ` ${c.opclass}`;
        return expr;
      })
      .join(", ");

    return `CREATE ${unique}INDEX IF NOT EXISTS ${this.quoteIdentifier(idx.name)} ON ${this.schemaQualified(table.schema, table.name)} USING ${method} (${colExprs})`;
  }

  generateDropIndex(indexName: string): string {
    return `DROP INDEX IF EXISTS ${this.quoteIdentifier(indexName)}`;
  }

  generateAddFK(table: TableDef, fk: ForeignKeyDef): string {
    const fromCols = fk.columnsFrom.map((c) => this.quoteIdentifier(c)).join(", ");
    const toCols = fk.columnsTo.map((c) => this.quoteIdentifier(c)).join(", ");
    const refSchema = fk.schemaTo || table.schema;
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(fk.name)} FOREIGN KEY (${fromCols}) REFERENCES ${this.schemaQualified(refSchema, fk.tableTo)}(${toCols}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
  }

  generateDropConstraint(table: TableDef, constraintName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}`;
  }

  generateAddCompositePK(table: TableDef, pk: CompositePKDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(pk.name)} PRIMARY KEY(${pk.columns.map((c) => this.quoteIdentifier(c)).join(",")})`;
  }

  generateAddUnique(table: TableDef, uc: UniqueConstraintDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(uc.name)} UNIQUE(${uc.columns.map((c) => this.quoteIdentifier(c)).join(",")})`;
  }

  generateCreateEnum(e: EnumDef): string {
    const values = e.values.map((v) => `'${v}'`).join(", ");
    return `DO $$ BEGIN\n\tCREATE TYPE ${this.schemaQualified(e.schema, e.name)} AS ENUM(${values});\nEXCEPTION\n\tWHEN duplicate_object THEN null;\nEND $$`;
  }

  generateDropEnum(e: EnumDef): string {
    return `DROP TYPE IF EXISTS ${this.schemaQualified(e.schema, e.name)}`;
  }
}

export const postgresDialect = new PostgresDialect();
