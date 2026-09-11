import type {
  ColumnDef,
  CompositePKDef,
  EnumDef,
  ForeignKeyDef,
  IndexDef,
  TableDef,
  UniqueConstraintDef,
} from "../snapshot";

export type DialectName = "postgres" | "mysql";

export interface SqlDialect {
  readonly name: DialectName;
  readonly supportsTransactionalDDL: boolean;

  quoteIdentifier(name: string): string;
  schemaQualified(schema: string, name: string): string;
  formatDefault(def: unknown): string;

  generateDropTable(table: TableDef): string;
  generateCreateTable(table: TableDef): string[];

  generateAddColumn(table: TableDef, col: ColumnDef): string;
  generateDropColumn(table: TableDef, colName: string): string;
  generateSetDefault(table: TableDef, colName: string, defaultVal: unknown): string;
  generateDropDefault(table: TableDef, colName: string): string;
  generateSetNotNull(table: TableDef, colName: string): string;
  generateDropNotNull(table: TableDef, colName: string): string;
  generateSetColumnType(table: TableDef, colName: string, type: string): string;

  generateCreateIndex(table: TableDef, idx: IndexDef): string;
  generateDropIndex(indexName: string): string;

  generateAddFK(table: TableDef, fk: ForeignKeyDef): string;
  generateDropConstraint(table: TableDef, constraintName: string): string;

  generateAddCompositePK(table: TableDef, pk: CompositePKDef): string;
  generateAddUnique(table: TableDef, uc: UniqueConstraintDef): string;

  generateCreateEnum(e: EnumDef): string;
  generateDropEnum(e: EnumDef): string;
}
