import { resolveDialect } from "../dialects/resolve";
import type { DatabaseAdapter } from "./adapter";
import { createMySqlAdapter } from "./mysql";
import { createPostgresAdapter } from "./postgres";
import { createSQLiteAdapter } from "./sqlite";

export function dialectArg(argv: string[]): string | undefined {
  const pos = argv.indexOf("--dialect");
  return pos === -1 ? undefined : argv[pos + 1];
}

export function createDatabaseAdapter(argv: string[]): DatabaseAdapter {
  const dialect = resolveDialect(dialectArg(argv));
  switch (dialect.name) {
    case "postgres":
      return createPostgresAdapter();
    case "mysql":
      return createMySqlAdapter();
    case "sqlite":
      return createSQLiteAdapter();
  }
}
