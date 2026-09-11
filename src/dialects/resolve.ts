import type { SqlDialect } from "./dialect";
import { mysqlDialect } from "./mysql";
import { postgresDialect } from "./postgres";

export function resolveDialect(value: string | undefined): SqlDialect {
  switch ((value || "postgres").toLowerCase()) {
    case "postgres":
    case "postgresql":
      return postgresDialect;
    case "mysql":
    case "mariadb":
      return mysqlDialect;
    default:
      throw new Error(`Unsupported dialect: ${value}`);
  }
}
