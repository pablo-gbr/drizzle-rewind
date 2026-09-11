import { requireDatabaseUrl } from "../config";
import type { DatabaseAdapter } from "./adapter";

type Queryable = Pick<import("pg").Pool, "query">;
type PoolClient = import("pg").PoolClient;

export const POSTGRES_MIGRATIONS_TABLE = '"drizzle"."__drizzle_migrations"';
export const POSTGRES_UNDEFINED_TABLE = "42P01";

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  readonly dialect = "postgres";

  constructor(
    private readonly db: Queryable,
    private readonly closeDb: () => Promise<void> = async () => {},
    private readonly getClient?: () => Promise<PoolClient>,
  ) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.db.query(sql, params);
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.db.query(sql, params);
  }

  async transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.getClient) return fn(this);

    const client = await this.getClient();
    const tx = new PostgresDatabaseAdapter(client);
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.closeDb();
  }

  isUndefinedTableError(err: unknown): boolean {
    return (err as { code?: string }).code === POSTGRES_UNDEFINED_TABLE;
  }
}

export function createPostgresAdapter(): DatabaseAdapter {
  const url = requireDatabaseUrl();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as typeof import("pg");
  const ssl = /[?&]sslmode=require/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new Pool({ connectionString: url, ...(ssl ? { ssl } : {}) });
  return new PostgresDatabaseAdapter(
    pool,
    () => pool.end(),
    () => pool.connect(),
  );
}
