import * as fs from "fs";
import * as path from "path";

import { color } from "../cli-colors";
import { logDatabaseUrlDiagnostic } from "../config";
import { migrationsTableDisplayName, type DatabaseAdapter } from "../db/adapter";
import { createDatabaseAdapter } from "../db/factory";
import { SQLITE_CREATE_MIGRATIONS_TABLE } from "../db/sqlite";
import {
  confirm,
  migrationHash,
  readJournal,
  type DbRow,
  type JournalEntry,
} from "../journal";

function parseArgs(argv: string[]) {
  let markApplied: number | null = null;
  let baseline = false;
  let cleanOrphans = false;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mark-applied" && argv[i + 1]) {
      markApplied = parseInt(argv[++i], 10);
    } else if (argv[i] === "--baseline") baseline = true;
    else if (argv[i] === "--clean-orphans") cleanOrphans = true;
    else if (argv[i] === "--force") force = true;
  }
  return { markApplied, baseline, cleanOrphans, force };
}

async function appliedTimestamps(db: DatabaseAdapter): Promise<Set<string>> {
  try {
    const rows = await db.query<{ created_at: string }>(
      `SELECT created_at FROM ${db.migrationsTable}`,
    );
    return new Set(rows.map((r) => String(r.created_at)));
  } catch (err) {
    if (db.isUndefinedTableError(err)) return new Set();
    logDatabaseUrlDiagnostic();
    throw err;
  }
}

async function markApplied(
  db: DatabaseAdapter,
  drizzleDir: string,
  entry: JournalEntry,
): Promise<void> {
  await ensureRepairTrackingTable(db);
  const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Migration file not found: ${sqlPath}`);
  }
  await db.execute(
    `INSERT INTO ${db.migrationsTable} (hash, created_at) VALUES (${db.placeholder(1)}, ${db.placeholder(2)})`,
    [migrationHash(sqlPath), String(entry.when)],
  );
}

async function ensureRepairTrackingTable(db: DatabaseAdapter): Promise<void> {
  if (db.dialect === "sqlite") {
    await db.execute(SQLITE_CREATE_MIGRATIONS_TABLE);
  }
}

function usage(): void {
  console.log(`${color("bold", "Usage:")} drizzle-rewind repair <option>\n`);
  console.log("  --mark-applied <idx>   Mark one migration applied without running its SQL");
  console.log("  --baseline             Mark every pending migration applied");
  console.log("  --clean-orphans        Delete tracking rows that are not in the journal");
  console.log("  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>");
  console.log("  --force                Skip confirmation prompts");
  console.log("\nRun 'drizzle-rewind status' to see the current state.");
}

export async function repair(drizzleDir: string, argv: string[]): Promise<void> {
  const opts = parseArgs(argv);

  if (opts.markApplied === null && !opts.baseline && !opts.cleanOrphans) {
    usage();
    return;
  }

  const journal = readJournal(drizzleDir);
  const db = createDatabaseAdapter(argv);

  if (opts.markApplied !== null) {
    const entry = journal.entries.find((e) => e.idx === opts.markApplied);
    if (!entry) {
      console.log(color("red", `No migration with idx ${opts.markApplied} in the journal.`));
      await db.close();
      process.exit(1);
    }
    if ((await appliedTimestamps(db)).has(String(entry.when))) {
      console.log(`${color("green", "Already applied:")} ${entry.tag}`);
      await db.close();
      return;
    }
    console.log(`${color("yellow", "Will mark as applied")} (without running SQL):\n`);
    console.log(`  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}\n`);
    if (!opts.force && !(await confirm("Proceed?"))) {
      console.log(color("yellow", "Cancelled."));
      await db.close();
      return;
    }
    await markApplied(db, drizzleDir, entry);
    console.log(`${color("green", "Marked")} ${entry.tag} as applied.`);
    await db.close();
    return;
  }

  if (opts.baseline) {
    const applied = await appliedTimestamps(db);
    const pending = journal.entries.filter((e) => !applied.has(String(e.when)));
    if (pending.length === 0) {
      console.log(color("green", "All migrations are already applied. Nothing to baseline."));
      await db.close();
      return;
    }
    console.log(`${color("yellow", `Will mark ${pending.length} migration(s) as applied`)} (without running SQL):\n`);
    for (const e of pending) {
      console.log(`  [${String(e.idx).padStart(4, "0")}] ${e.tag}`);
    }
    console.log("");
    if (!opts.force && !(await confirm("Proceed?"))) {
      console.log(color("yellow", "Cancelled."));
      await db.close();
      return;
    }
    for (const e of pending) {
      await markApplied(db, drizzleDir, e);
      console.log(`  ${color("green", "Marked")} ${e.tag} as applied.`);
    }
    console.log(`\n${color("green", "Baselined")} ${pending.length} migration(s).`);
    await db.close();
    return;
  }

  // --clean-orphans
  const journalTimestamps = new Set(journal.entries.map((e) => String(e.when)));
  let dbRows: DbRow[] = [];
  try {
    dbRows = await db.query<DbRow>(
      `SELECT id, hash, created_at FROM ${db.migrationsTable} ORDER BY created_at`,
    );
  } catch (err) {
    if (!db.isUndefinedTableError(err)) {
      logDatabaseUrlDiagnostic();
      throw err;
    }
    console.log(`${color("yellow", "No tracking table:")} ${migrationsTableDisplayName(db)}`);
    await db.close();
    return;
  }

  const orphans = dbRows.filter((r) => !journalTimestamps.has(String(r.created_at)));
  if (orphans.length === 0) {
    console.log(color("green", "No orphan entries found."));
    await db.close();
    return;
  }

  console.log(`${color("yellow", `Found ${orphans.length} orphan(s) to remove:`)}\n`);
  for (const o of orphans) {
    console.log(`  id=${o.id} hash=${o.hash.substring(0, 16)}... created_at=${o.created_at}`);
  }
  console.log("");

  if (!opts.force && !(await confirm("Remove these orphan entries?"))) {
    console.log(color("yellow", "Cancelled."));
    await db.close();
    return;
  }

  for (const o of orphans) {
    await db.execute(
      `DELETE FROM ${db.migrationsTable} WHERE id = ${db.placeholder(1)}`,
      [o.id],
    );
  }
  console.log(`${color("green", "Removed")} ${orphans.length} orphan row(s).`);
  await db.close();
}
