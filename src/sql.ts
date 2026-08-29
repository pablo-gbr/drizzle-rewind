import type {
  ColumnDef,
  CompositePKDef,
  EnumDef,
  ForeignKeyDef,
  IndexDef,
  TableDef,
  UniqueConstraintDef,
} from "./snapshot";

export function quote(name: string): string {
  return `"${name}"`;
}

export function schemaQualified(schema: string, name: string): string {
  return `${quote(schema || "public")}.${quote(name)}`;
}

export function formatDefault(def: unknown): string {
  if (def === null || def === undefined) return "";
  if (typeof def === "boolean") return def.toString();
  if (typeof def === "number") return def.toString();
  return String(def);
}

export function generateDropTable(table: TableDef): string {
  return `DROP TABLE IF EXISTS ${schemaQualified(table.schema, table.name)} CASCADE`;
}

export function generateCreateTable(table: TableDef): string[] {
  const statements: string[] = [];
  const columnDefs: string[] = [];

  for (const col of Object.values(table.columns)) {
    let colSql = `\t${quote(col.name)} ${col.type}`;
    if (col.primaryKey) colSql += " PRIMARY KEY";
    if (col.notNull) colSql += " NOT NULL";
    if (col.default !== undefined && col.default !== null) {
      colSql += ` DEFAULT ${formatDefault(col.default)}`;
    }
    columnDefs.push(colSql);
  }

  for (const cpk of Object.values(table.compositePrimaryKeys)) {
    columnDefs.push(
      `\tCONSTRAINT ${quote(cpk.name)} PRIMARY KEY(${cpk.columns.map(quote).join(",")})`,
    );
  }

  for (const uc of Object.values(table.uniqueConstraints)) {
    columnDefs.push(
      `\tCONSTRAINT ${quote(uc.name)} UNIQUE(${uc.columns.map(quote).join(",")})`,
    );
  }

  statements.push(
    `CREATE TABLE IF NOT EXISTS ${schemaQualified(table.schema, table.name)} (\n${columnDefs.join(",\n")}\n)`,
  );

  for (const fk of Object.values(table.foreignKeys)) {
    statements.push(generateAddFK(table, fk));
  }

  for (const idx of Object.values(table.indexes)) {
    statements.push(generateCreateIndex(table, idx));
  }

  return statements;
}

export function generateAddColumn(table: TableDef, col: ColumnDef): string {
  let sql = `ALTER TABLE ${schemaQualified(table.schema, table.name)} ADD COLUMN ${quote(col.name)} ${col.type}`;
  if (col.notNull) sql += " NOT NULL";
  if (col.default !== undefined && col.default !== null) {
    sql += ` DEFAULT ${formatDefault(col.default)}`;
  }
  return sql;
}

export function generateDropColumn(table: TableDef, colName: string): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} DROP COLUMN ${quote(colName)}`;
}

export function generateSetDefault(
  table: TableDef,
  colName: string,
  defaultVal: unknown,
): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ALTER COLUMN ${quote(colName)} SET DEFAULT ${formatDefault(defaultVal)}`;
}

export function generateDropDefault(table: TableDef, colName: string): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ALTER COLUMN ${quote(colName)} DROP DEFAULT`;
}

export function generateSetNotNull(table: TableDef, colName: string): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ALTER COLUMN ${quote(colName)} SET NOT NULL`;
}

export function generateDropNotNull(table: TableDef, colName: string): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ALTER COLUMN ${quote(colName)} DROP NOT NULL`;
}

export function generateSetColumnType(
  table: TableDef,
  colName: string,
  type: string,
): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ALTER COLUMN ${quote(colName)} SET DATA TYPE ${type}`;
}

export function generateCreateIndex(table: TableDef, idx: IndexDef): string {
  const unique = idx.isUnique ? "UNIQUE " : "";
  const method = idx.method || "btree";

  const colExprs = idx.columns
    .map((c) => {
      let expr = c.isExpression ? c.expression : quote(c.expression);
      if (c.opclass) expr += ` ${c.opclass}`;
      return expr;
    })
    .join(", ");

  return `CREATE ${unique}INDEX IF NOT EXISTS ${quote(idx.name)} ON ${schemaQualified(table.schema, table.name)} USING ${method} (${colExprs})`;
}

export function generateDropIndex(indexName: string): string {
  return `DROP INDEX IF EXISTS ${quote(indexName)}`;
}

export function generateAddFK(table: TableDef, fk: ForeignKeyDef): string {
  const fromCols = fk.columnsFrom.map(quote).join(", ");
  const toCols = fk.columnsTo.map(quote).join(", ");
  const refSchema = fk.schemaTo || table.schema;
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${quote(fk.name)} FOREIGN KEY (${fromCols}) REFERENCES ${schemaQualified(refSchema, fk.tableTo)}(${toCols}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
}

export function generateDropConstraint(
  table: TableDef,
  constraintName: string,
): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} DROP CONSTRAINT ${quote(constraintName)}`;
}

export function generateAddCompositePK(
  table: TableDef,
  pk: CompositePKDef,
): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${quote(pk.name)} PRIMARY KEY(${pk.columns.map(quote).join(",")})`;
}

export function generateAddUnique(
  table: TableDef,
  uc: UniqueConstraintDef,
): string {
  return `ALTER TABLE ${schemaQualified(table.schema, table.name)} ADD CONSTRAINT ${quote(uc.name)} UNIQUE(${uc.columns.map(quote).join(",")})`;
}

export function generateCreateEnum(e: EnumDef): string {
  const values = e.values.map((v) => `'${v}'`).join(", ");
  return `DO $$ BEGIN\n\tCREATE TYPE ${schemaQualified(e.schema, e.name)} AS ENUM(${values});\nEXCEPTION\n\tWHEN duplicate_object THEN null;\nEND $$`;
}

export function generateDropEnum(e: EnumDef): string {
  return `DROP TYPE IF EXISTS ${schemaQualified(e.schema, e.name)}`;
}
