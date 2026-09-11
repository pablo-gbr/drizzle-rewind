import { resolveDialect } from "../dialects/resolve";
import type { DatabaseAdapter } from "./adapter";
import { createMySqlAdapter } from "./mysql";
import { createPostgresAdapter } from "./postgres";

export function dialectArg(argv: string[]): string | undefined {
  const pos = argv.indexOf("--dialect");
  return pos === -1 ? undefined : argv[pos + 1];
}

export function createDatabaseAdapter(argv: string[]): DatabaseAdapter {
  const dialect = resolveDialect(dialectArg(argv));
  return dialect.name === "mysql" ? createMySqlAdapter() : createPostgresAdapter();
}
