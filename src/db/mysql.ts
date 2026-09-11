import { requireDatabaseUrl } from "../config";
import type { DatabaseAdapter } from "./adapter";

type MySqlRows = unknown[];
type MySqlQueryable = {
  query(sql: string, params?: unknown[]): Promise<[MySqlRows, unknown]>;
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
};
type MySqlConnection = MySqlQueryable & {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
};
type MySqlPool = MySqlQueryable & {
  end(): Promise<void>;
  getConnection(): Promise<MySqlConnection>;
};

export const MYSQL_MIGRATIONS_TABLE = "`__drizzle_migrations`";

export class MySqlDatabaseAdapter implements DatabaseAdapter {
  readonly dialect = "mysql";
  readonly migrationsTable = MYSQL_MIGRATIONS_TABLE;

  constructor(
    private readonly db: MySqlQueryable,
    private readonly closeDb: () => Promise<void> = async () => {},
    private readonly getConnection?: () => Promise<MySqlConnection>,
  ) {}

  placeholder(_position: number): string {
    return "?";
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.db.query(sql, params);
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.db.execute(sql, params);
  }

  async transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (!this.getConnection) return fn(this);

    const connection = await this.getConnection();
    const tx = new MySqlDatabaseAdapter(connection);
    try {
      await connection.beginTransaction();
      const result = await fn(tx);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  close(): Promise<void> {
    return this.closeDb();
  }

  isUndefinedTableError(err: unknown): boolean {
    const e = err as { code?: string; errno?: number };
    return e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146;
  }
}

export function createMySqlAdapter(): DatabaseAdapter {
  const url = requireDatabaseUrl();
  // mysql2 is intentionally loaded lazily so file-only commands do not need it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mysql = require("mysql2/promise") as {
    createPool(uri: string): MySqlPool;
  };
  const pool = mysql.createPool(url);
  return new MySqlDatabaseAdapter(
    pool,
    () => pool.end(),
    () => pool.getConnection(),
  );
}
