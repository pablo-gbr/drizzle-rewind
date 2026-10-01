import { spawn } from "child_process";

import { color } from "../cli-colors";
import { logDatabaseUrlDiagnostic } from "../config";
import { type DatabaseAdapter } from "../db/adapter";
import { createDatabaseAdapter } from "../db/factory";
import { EXIT } from "../exit-codes";
import { confirm } from "../journal";

interface ResetOptions {
  force: boolean;
  dryRun: boolean;
  migrate: boolean;
  drizzleKitArgs: string[];
}

export function parseResetArgs(argv: string[]): ResetOptions {
  const drizzleKitArgs: string[] = [];
  let force = false;
  let dryRun = false;
  let migrate = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force" || arg === "--yes") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--migrate" || arg === "--with-migrations") migrate = true;
    else if (arg === "--dialect") i++;
    else if (arg === "--dir") i++;
    else drizzleKitArgs.push(arg);
  }

  return { force, dryRun, migrate, drizzleKitArgs };
}

export async function reset(_drizzleDir: string, argv: string[]): Promise<void> {
  const opts = parseResetArgs(argv);
  const db = createDatabaseAdapter(argv);
  const drizzleKitCommand = opts.migrate ? "migrate" : "push";

  console.log(color("red", `Will DROP all objects in the connected ${db.dialect} database.`));
  console.log(`${color("cyan", "Then run:")} drizzle-kit ${drizzleKitCommand}${formatArgs(opts.drizzleKitArgs)}\n`);

  if (opts.dryRun) {
    let statements: string[];
    try {
      statements = await resetStatements(db);
    } catch (err) {
      logDatabaseUrlDiagnostic();
      throw err;
    }
    for (const stmt of statements) console.log(`${stmt};`);
    console.log(color("green", "\nDry run only. No database changes were made."));
    await db.close();
    return;
  }

  if (!opts.force && !(await confirm("Reset this database?"))) {
    console.log(color("yellow", "Cancelled."));
    await db.close();
    return;
  }

  try {
    await dropDatabaseObjects(db);
  } catch (err) {
    logDatabaseUrlDiagnostic();
    throw err;
  } finally {
    await db.close();
  }

  await runDrizzleKit(drizzleKitCommand, opts.drizzleKitArgs);
}

async function dropDatabaseObjects(db: DatabaseAdapter): Promise<void> {
  for (const stmt of await resetStatements(db)) {
    await db.execute(stmt);
  }
}

export async function resetStatements(db: DatabaseAdapter): Promise<string[]> {
  switch (db.dialect) {
    case "postgres":
      return [
        "DO $$ DECLARE r record; BEGIN FOR r IN SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname); END LOOP; END $$",
        "CREATE SCHEMA public",
      ];
    case "mysql":
      return mysqlResetStatements(db);
    case "sqlite":
      return sqliteResetStatements(db);
  }
}

async function mysqlResetStatements(db: DatabaseAdapter): Promise<string[]> {
  const tables = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  );
  const views = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.views WHERE table_schema = DATABASE()",
  );
  const routines = await db.query<{ routine_name: string; routine_type: string }>(
    "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = DATABASE()",
  );
  const events = await db.query<{ event_name: string }>(
    "SELECT event_name FROM information_schema.events WHERE event_schema = DATABASE()",
  );

  return [
    "SET FOREIGN_KEY_CHECKS = 0",
    ...views.map((row) => `DROP VIEW IF EXISTS ${quoteMySql(row.table_name)}`),
    ...tables.map((row) => `DROP TABLE IF EXISTS ${quoteMySql(row.table_name)}`),
    ...routines.map(
      (row) => `DROP ${row.routine_type.toUpperCase()} IF EXISTS ${quoteMySql(row.routine_name)}`,
    ),
    ...events.map((row) => `DROP EVENT IF EXISTS ${quoteMySql(row.event_name)}`),
    "SET FOREIGN_KEY_CHECKS = 1",
  ];
}

async function sqliteResetStatements(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.query<{ type: string; name: string }>(
    "SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'trigger') ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'trigger' THEN 1 ELSE 2 END",
  );
  return rows.map((row) => {
    const kind = row.type.toUpperCase();
    return `DROP ${kind} IF EXISTS ${quoteSqlite(row.name)}`;
  });
}

function quoteMySql(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

function quoteSqlite(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function formatArgs(args: string[]): string {
  return args.length === 0 ? "" : ` ${args.join(" ")}`;
}

function runDrizzleKit(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(npxBin(), ["drizzle-kit", command, ...args], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else {
        console.error(color("red", `drizzle-kit ${command} exited with code ${code ?? "unknown"}.`));
        process.exitCode = EXIT.DATABASE_EXECUTION_FAILED;
        reject(new Error("drizzle-kit failed"));
      }
    });
  });
}

function npxBin(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}
