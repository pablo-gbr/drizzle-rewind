import { postgresDialect } from "./dialects/postgres";
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
  return postgresDialect.quoteIdentifier(name);
}

export function schemaQualified(schema: string, name: string): string {
  return postgresDialect.schemaQualified(schema, name);
}

export function formatDefault(def: unknown): string {
  return postgresDialect.formatDefault(def);
}

export function generateDropTable(table: TableDef): string {
  return postgresDialect.generateDropTable(table);
}

export function generateCreateTable(table: TableDef): string[] {
  return postgresDialect.generateCreateTable(table);
}

export function generateAddColumn(table: TableDef, col: ColumnDef): string {
  return postgresDialect.generateAddColumn(table, col);
}

export function generateDropColumn(table: TableDef, colName: string): string {
  return postgresDialect.generateDropColumn(table, colName);
}

export function generateSetDefault(
  table: TableDef,
  colName: string,
  defaultVal: unknown,
): string {
  return postgresDialect.generateSetDefault(table, colName, defaultVal);
}

export function generateDropDefault(table: TableDef, colName: string): string {
  return postgresDialect.generateDropDefault(table, colName);
}

export function generateSetNotNull(table: TableDef, colName: string): string {
  return postgresDialect.generateSetNotNull(table, colName);
}

export function generateDropNotNull(table: TableDef, colName: string): string {
  return postgresDialect.generateDropNotNull(table, colName);
}

export function generateSetColumnType(
  table: TableDef,
  colName: string,
  type: string,
): string {
  return postgresDialect.generateSetColumnType(table, colName, type);
}

export function generateCreateIndex(table: TableDef, idx: IndexDef): string {
  return postgresDialect.generateCreateIndex(table, idx);
}

export function generateDropIndex(indexName: string): string {
  return postgresDialect.generateDropIndex({ schema: "", name: "" } as TableDef, indexName);
}

export function generateAddFK(table: TableDef, fk: ForeignKeyDef): string {
  return postgresDialect.generateAddFK(table, fk);
}

export function generateDropConstraint(
  table: TableDef,
  constraintName: string,
): string {
  return postgresDialect.generateDropForeignKey(table, constraintName);
}

export function generateAddCompositePK(
  table: TableDef,
  pk: CompositePKDef,
): string {
  return postgresDialect.generateAddCompositePK(table, pk);
}

export function generateAddUnique(
  table: TableDef,
  uc: UniqueConstraintDef,
): string {
  return postgresDialect.generateAddUnique(table, uc);
}

export function generateCreateEnum(e: EnumDef): string {
  return postgresDialect.generateCreateEnum(e);
}

export function generateDropEnum(e: EnumDef): string {
  return postgresDialect.generateDropEnum(e);
}
