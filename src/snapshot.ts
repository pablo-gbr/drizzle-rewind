// Shapes of the snapshot JSON drizzle-kit writes into <out>/meta/*_snapshot.json.
// Only the fields the differ reads are modelled.

export interface ColumnDef {
  name: string;
  type: string;
  typeSchema?: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: unknown;
  autoIncrement?: boolean;
  autoincrement?: boolean;
  generated?: unknown;
}

export interface IndexColumn {
  expression: string;
  isExpression: boolean;
  asc: boolean;
  nulls: string;
  opclass?: string;
}

export interface IndexDef {
  name: string;
  columns: IndexColumn[];
  isUnique: boolean;
  concurrently: boolean;
  method: string;
  with: Record<string, unknown>;
}

export interface ForeignKeyDef {
  name: string;
  tableFrom: string;
  tableTo: string;
  schemaTo?: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
}

export interface CompositePKDef {
  name: string;
  columns: string[];
}

export interface UniqueConstraintDef {
  name: string;
  columns: string[];
  nullsNotDistinct?: boolean;
}

export interface TableDef {
  name: string;
  schema: string;
  columns: Record<string, ColumnDef>;
  indexes: Record<string, IndexDef>;
  foreignKeys: Record<string, ForeignKeyDef>;
  compositePrimaryKeys: Record<string, CompositePKDef>;
  uniqueConstraints: Record<string, UniqueConstraintDef>;
  policies: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
  isRLSEnabled: boolean;
}

export interface EnumDef {
  name: string;
  schema: string;
  values: string[];
}

export interface Snapshot {
  id: string;
  prevId: string;
  version: string;
  dialect: string;
  tables: Record<string, TableDef>;
  enums: Record<string, EnumDef>;
  schemas: Record<string, unknown>;
  _meta: {
    columns: Record<string, unknown>;
    schemas: Record<string, unknown>;
    tables: Record<string, unknown>;
  };
}

export function emptySnapshot(): Snapshot {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    prevId: "",
    version: "7",
    dialect: "postgresql",
    tables: {},
    enums: {},
    schemas: {},
    _meta: { columns: {}, schemas: {}, tables: {} },
  };
}
