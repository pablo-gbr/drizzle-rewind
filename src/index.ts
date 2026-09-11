// Programmatic API. Every CLI command is callable from code, so a project can
// wire rollback into its own tooling instead of shelling out.
export { generate } from "./commands/generate";
export { status } from "./commands/status";
export { rollback } from "./commands/rollback";
export { repair } from "./commands/repair";

export { diffSnapshots, type DiffResult } from "./diff";
export { type SqlDialect, type DialectName } from "./dialects/dialect";
export { MySqlDialect, mysqlDialect } from "./dialects/mysql";
export { PostgresDialect, postgresDialect } from "./dialects/postgres";
export { resolveDialect } from "./dialects/resolve";
export { type DatabaseAdapter } from "./db/adapter";
export { createDatabaseAdapter, dialectArg } from "./db/factory";
export {
  MYSQL_MIGRATIONS_TABLE,
  MySqlDatabaseAdapter,
  createMySqlAdapter,
} from "./db/mysql";
export {
  POSTGRES_MIGRATIONS_TABLE,
  POSTGRES_UNDEFINED_TABLE,
  PostgresDatabaseAdapter,
  createPostgresAdapter,
} from "./db/postgres";
export { emptySnapshot, type Snapshot, type TableDef } from "./snapshot";
export { resolveDrizzleDir, createPool } from "./config";
export {
  readJournal,
  findSnapshotFile,
  BREAKPOINT,
  type Journal,
  type JournalEntry,
} from "./journal";
