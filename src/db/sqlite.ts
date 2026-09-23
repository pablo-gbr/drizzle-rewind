import { requireDatabaseUrl } from "../config";
import type { DatabaseAdapter } from "./adapter";
import { parseSqliteDatabaseUrl } from "./sqlite-url";
import { pathToFileURL } from "url";

type LibSqlRows = unknown[];
type LibSqlExecuteResult = { rows: LibSqlRows };
type LibSqlClient = {
  execute(
    stmt: string | { sql: string; args?: unknown[] },
  ): Promise<LibSqlExecuteResult>;
  close?: () => void | Promise<void>;
};

export const SQLITE_MIGRATIONS_TABLE = '"__drizzle_migrations"';
export const SQLITE_CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS ${SQLITE_MIGRATIONS_TABLE} (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  hash text NOT NULL,
  created_at numeric
)`;

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  readonly dialect = "sqlite";
  readonly migrationsTable = SQLITE_MIGRATIONS_TABLE;

  constructor(
    private readonly db: LibSqlClient,
    private readonly closeDb: () => Promise<void> = async () => {},
  ) {}

  placeholder(_position: number): string {
    return "?";
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.db.execute({ sql, args: params ?? [] });
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.db.execute({ sql, args: params ?? [] });
  }

  async transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    await this.db.execute("BEGIN");
    try {
      const result = await fn(this);
      await this.db.execute("COMMIT");
      return result;
    } catch (err) {
      await this.db.execute("ROLLBACK");
      throw err;
    }
  }

  close(): Promise<void> {
    return this.closeDb();
  }

  isUndefinedTableError(err: unknown): boolean {
    const e = err as { code?: string; message?: string };
    return (
      e.code === "SQLITE_UNKNOWN" || /no such table/i.test(e.message ?? "")
    );
  }
}

export function createSQLiteAdapter(): DatabaseAdapter {
  const rawUrl = requireDatabaseUrl();
  const url = libSqlUrl(rawUrl);
  // @libsql/client is intentionally loaded lazily so file-only commands do not need it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@libsql/client") as {
    createClient(opts: { url: string; authToken?: string }): LibSqlClient;
  };
  const authToken = resolveSqliteAuthToken(rawUrl);
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  return new SQLiteDatabaseAdapter(client, async () => {
    await client.close?.();
  });
}

function libSqlUrl(value: string): string {
  const parsed = parseSqliteDatabaseUrl(value);
  if (isRemoteSqliteUrl(parsed)) return parsed;
  return pathToFileURL(parsed).href;
}

function resolveSqliteAuthToken(value: string): string | undefined {
  return isRemoteSqliteUrl(value.trim())
    ? (process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN)
    : undefined;
}

function isRemoteSqliteUrl(value: string): boolean {
  return /^(libsql|turso|https?|wss?):\/\//i.test(value);
}
