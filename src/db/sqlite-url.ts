import * as path from "path";

export function parseSqliteDatabaseUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("SQLite DATABASE_URL is empty.");

  const lower = input.toLowerCase();
  if (input === ":memory:" || lower === "file::memory:") {
    throw new Error(
      `Unsupported SQLite DATABASE_URL: ${value}. In-memory SQLite databases are not useful for rollback CLI commands.`,
    );
  }

  if (
    lower.startsWith("libsql://") ||
    lower.startsWith("turso://") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("ws://") ||
    lower.startsWith("wss://")
  ) {
    return input;
  }

  if (lower.startsWith("sqlite://")) {
    const filePath = input.slice("sqlite://".length);
    if (!filePath) throw new Error("SQLite DATABASE_URL is missing a database path.");
    return path.resolve(filePath);
  }

  if (lower.startsWith("sqlite:")) {
    const filePath = input.slice("sqlite:".length);
    if (!filePath) throw new Error("SQLite DATABASE_URL is missing a database path.");
    return path.resolve(filePath);
  }

  if (lower.startsWith("file:")) {
    const filePath = input.slice("file:".length);
    if (!filePath) throw new Error("SQLite DATABASE_URL is missing a database path.");
    return path.resolve(filePath);
  }

  return path.resolve(input);
}

export const parseSqliteDatabasePath = parseSqliteDatabaseUrl;
