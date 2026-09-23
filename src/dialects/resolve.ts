import type { SqlDialect } from "./dialect";
import { mysqlDialect } from "./mysql";
import { postgresDialect } from "./postgres";
import { sqliteDialect } from "./sqlite";

export function resolveDialect(value: string | undefined): SqlDialect {
  switch ((value || "postgres").toLowerCase()) {
    case "postgres":
    case "postgresql":
      return postgresDialect;
    case "mysql":
    case "mariadb":
      return mysqlDialect;
    case "sqlite":
    case "sqlite3":
    case "libsql":
    case "turso":
      return sqliteDialect;
    default:
      throw new Error(`Unsupported dialect: ${value}`);
  }
}
