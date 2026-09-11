import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import type { DatabaseAdapter } from "../db/adapter";
import { createDatabaseAdapter } from "../db/factory";
import { confirm, readJournal, type DbRow, type JournalEntry } from "../journal";

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
    throw err;
  }
}

async function markApplied(
  db: DatabaseAdapter,
  drizzleDir: string,
  entry: JournalEntry,
): Promise<void> {
  const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`Migration file not found: ${sqlPath}`);
  }
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(sqlPath, "utf-8"))
    .digest("hex");
  await db.execute(
    `INSERT INTO ${db.migrationsTable} (hash, created_at) VALUES (${db.placeholder(1)}, ${db.placeholder(2)})`,
    [hash, String(entry.when)],
  );
}

function usage(): void {
  console.log("Usage: drizzle-rewind repair <option>\n");
  console.log("  --mark-applied <idx>   Mark one migration applied without running its SQL");
  console.log("  --baseline             Mark every pending migration applied");
  console.log("  --clean-orphans        Delete tracking rows that are not in the journal");
  console.log("  --dialect <postgres|mysql|mariadb>");
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
      console.log(`No migration with idx ${opts.markApplied} in the journal.`);
      await db.close();
      process.exit(1);
    }
    if ((await appliedTimestamps(db)).has(String(entry.when))) {
      console.log(`${entry.tag} is already marked as applied.`);
      await db.close();
      return;
    }
    console.log("Will mark as applied (without running SQL):\n");
    console.log(`  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}\n`);
    if (!opts.force && !(await confirm("Proceed?"))) {
      console.log("Cancelled.");
      await db.close();
      return;
    }
    await markApplied(db, drizzleDir, entry);
    console.log(`Marked ${entry.tag} as applied.`);
    await db.close();
    return;
  }

  if (opts.baseline) {
    const applied = await appliedTimestamps(db);
    const pending = journal.entries.filter((e) => !applied.has(String(e.when)));
    if (pending.length === 0) {
      console.log("All migrations are already applied. Nothing to baseline.");
      await db.close();
      return;
    }
    console.log(`Will mark ${pending.length} migration(s) as applied (without running SQL):\n`);
    for (const e of pending) {
      console.log(`  [${String(e.idx).padStart(4, "0")}] ${e.tag}`);
    }
    console.log("");
    if (!opts.force && !(await confirm("Proceed?"))) {
      console.log("Cancelled.");
      await db.close();
      return;
    }
    for (const e of pending) {
      await markApplied(db, drizzleDir, e);
      console.log(`  Marked ${e.tag} as applied.`);
    }
    console.log(`\nBaselined ${pending.length} migration(s).`);
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
    if (!db.isUndefinedTableError(err)) throw err;
    console.log("No drizzle.__drizzle_migrations table found.");
    await db.close();
    return;
  }

  const orphans = dbRows.filter((r) => !journalTimestamps.has(String(r.created_at)));
  if (orphans.length === 0) {
    console.log("No orphan entries found.");
    await db.close();
    return;
  }

  console.log(`Found ${orphans.length} orphan(s) to remove:\n`);
  for (const o of orphans) {
    console.log(`  id=${o.id} hash=${o.hash.substring(0, 16)}... created_at=${o.created_at}`);
  }
  console.log("");

  if (!opts.force && !(await confirm("Remove these orphan entries?"))) {
    console.log("Cancelled.");
    await db.close();
    return;
  }

  for (const o of orphans) {
    await db.execute(
      `DELETE FROM ${db.migrationsTable} WHERE id = ${db.placeholder(1)}`,
      [o.id],
    );
  }
  console.log(`Removed ${orphans.length} orphan row(s).`);
  await db.close();
}
