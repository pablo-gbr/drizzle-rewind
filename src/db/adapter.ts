import type { DialectName } from "../dialects/dialect";

export interface DatabaseAdapter {
  readonly dialect: DialectName;
  readonly migrationsTable: string;

  placeholder(position: number): string;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isUndefinedTableError(err: unknown): boolean;
}
