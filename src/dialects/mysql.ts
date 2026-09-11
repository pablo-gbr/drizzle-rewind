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

export class MySqlDialect implements SqlDialect {
  readonly name = "mysql";
  readonly supportsTransactionalDDL = false;

  quoteIdentifier(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
  }

  schemaQualified(schema: string, name: string): string {
    if (!schema) return this.quoteIdentifier(name);
    return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(name)}`;
  }

  formatDefault(def: unknown): string {
    if (def === null || def === undefined) return "";
    if (typeof def === "boolean") return def ? "true" : "false";
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

    const statements = [
      `CREATE TABLE IF NOT EXISTS ${this.schemaQualified(table.schema, table.name)} (\n${columnDefs.join(",\n")}\n)`,
    ];

    for (const fk of Object.values(table.foreignKeys)) {
      statements.push(this.generateAddFK(table, fk));
    }

    for (const idx of Object.values(table.indexes)) {
      statements.push(this.generateCreateIndex(table, idx));
    }

    return statements;
  }

  generateAddColumn(table: TableDef, col: ColumnDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD COLUMN ${this.columnDefinition(col)}`;
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
    const col = table.columns[colName];
    return col
      ? this.generateModifyColumn(table, { ...col, notNull: true })[0]
      : `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} MODIFY COLUMN ${this.quoteIdentifier(colName)} NOT NULL`;
  }

  generateDropNotNull(table: TableDef, colName: string): string {
    const col = table.columns[colName];
    return col
      ? this.generateModifyColumn(table, { ...col, notNull: false })[0]
      : `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} MODIFY COLUMN ${this.quoteIdentifier(colName)} NULL`;
  }

  generateSetColumnType(table: TableDef, colName: string, type: string): string {
    const col = table.columns[colName];
    return col
      ? this.generateModifyColumn(table, { ...col, type })[0]
      : `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} MODIFY COLUMN ${this.quoteIdentifier(colName)} ${type}`;
  }

  generateModifyColumn(table: TableDef, col: ColumnDef): string[] {
    return [
      `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} MODIFY COLUMN ${this.columnDefinition(col)}`,
    ];
  }

  generateCreateIndex(table: TableDef, idx: IndexDef): string {
    const unique = idx.isUnique ? "UNIQUE " : "";
    const colExprs = idx.columns
      .map((c) => {
        let expr = c.isExpression ? c.expression : this.quoteIdentifier(c.expression);
        if (!c.isExpression && c.asc === false) expr += " DESC";
        return expr;
      })
      .join(", ");

    return `CREATE ${unique}INDEX ${this.quoteIdentifier(idx.name)} ON ${this.schemaQualified(table.schema, table.name)} (${colExprs})`;
  }

  generateDropIndex(table: TableDef, indexName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP INDEX ${this.quoteIdentifier(indexName)}`;
  }

  generateAddFK(table: TableDef, fk: ForeignKeyDef): string {
    const fromCols = fk.columnsFrom.map((c) => this.quoteIdentifier(c)).join(", ");
    const toCols = fk.columnsTo.map((c) => this.quoteIdentifier(c)).join(", ");
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(fk.name)} FOREIGN KEY (${fromCols}) REFERENCES ${this.schemaQualified(fk.schemaTo || "", fk.tableTo)}(${toCols}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
  }

  generateDropForeignKey(table: TableDef, constraintName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP FOREIGN KEY ${this.quoteIdentifier(constraintName)}`;
  }

  generateAddCompositePK(table: TableDef, pk: CompositePKDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(pk.name)} PRIMARY KEY(${pk.columns.map((c) => this.quoteIdentifier(c)).join(",")})`;
  }

  generateDropPrimaryKey(table: TableDef, _pkName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP PRIMARY KEY`;
  }

  generateAddUnique(table: TableDef, uc: UniqueConstraintDef): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${this.quoteIdentifier(uc.name)} UNIQUE(${uc.columns.map((c) => this.quoteIdentifier(c)).join(",")})`;
  }

  generateDropUnique(table: TableDef, constraintName: string): string {
    return `ALTER TABLE ${this.schemaQualified(table.schema, table.name)} DROP INDEX ${this.quoteIdentifier(constraintName)}`;
  }

  generateCreateEnum(e: EnumDef): string {
    throw new Error(`MariaDB does not support standalone enum type ${e.name}.`);
  }

  generateDropEnum(e: EnumDef): string {
    throw new Error(`MariaDB does not support standalone enum type ${e.name}.`);
  }

  private columnDefinition(col: ColumnDef): string {
    if (col.generated !== undefined) {
      throw new Error(`Generated column ${col.name} is not supported for MariaDB yet.`);
    }

    let sql = `${this.quoteIdentifier(col.name)} ${col.type}`;
    if (col.primaryKey) sql += " PRIMARY KEY";
    sql += col.notNull || col.primaryKey ? " NOT NULL" : " NULL";
    if (col.default !== undefined && col.default !== null) {
      sql += ` DEFAULT ${this.formatDefault(col.default)}`;
    }
    if (col.autoIncrement) sql += " AUTO_INCREMENT";
    return sql;
  }
}

export const mysqlDialect = new MySqlDialect();
