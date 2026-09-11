import * as fs from "fs";
import * as path from "path";

/**
 * Where the drizzle-kit output lives. Resolution order:
 *   1. --dir <path> on the command line
 *   2. DRIZZLE_DIR in the environment
 *   3. the `out` value in ./drizzle.config.ts (read as text, not evaluated)
 *   4. ./drizzle
 */
export function resolveDrizzleDir(argv: string[] = process.argv.slice(2)): string {
  const flagPos = argv.indexOf("--dir");
  if (flagPos !== -1 && argv[flagPos + 1]) {
    return path.resolve(argv[flagPos + 1]);
  }
  if (process.env.DRIZZLE_DIR) return path.resolve(process.env.DRIZZLE_DIR);

  for (const name of ["drizzle.config.ts", "drizzle.config.js"]) {
    const cfg = path.resolve(process.cwd(), name);
    if (!fs.existsSync(cfg)) continue;
    // Text-scrape rather than import: the config may be ESM, may import the
    // schema, and may read env vars we do not have. We only need one string.
    const match = fs
      .readFileSync(cfg, "utf-8")
      .match(/\bout\s*:\s*["'`]([^"'`]+)["'`]/);
    if (match) return path.resolve(path.dirname(cfg), match[1]);
  }

  return path.resolve(process.cwd(), "drizzle");
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Export it, or put it in a .env file that your shell loads.",
    );
    process.exit(1);
  }
  return url;
}

/**
 * Compatibility export for callers that used the old programmatic API.
 * Commands now go through db/postgres.ts so future dialects do not inherit pg.
 */
export function createPool(): import("pg").Pool {
  const url = requireDatabaseUrl();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as typeof import("pg");
  const ssl = /[?&]sslmode=require/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  return new Pool({ connectionString: url, ...(ssl ? { ssl } : {}) });
}
