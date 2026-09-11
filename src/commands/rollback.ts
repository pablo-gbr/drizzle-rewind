import * as fs from "fs";
import * as path from "path";

import {
  POSTGRES_MIGRATIONS_TABLE,
  createPostgresAdapter,
} from "../db/postgres";
import {
  BREAKPOINT,
  confirm,
  findSnapshotFile,
  journalPath,
  readJournal,
  writeFileAtomic,
  type Journal,
  type JournalEntry,
} from "../journal";

function parseArgs(argv: string[]) {
  let steps = 1;
  let to: number | null = null;
  let force = false;
  let remove = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--steps" && argv[i + 1]) steps = parseInt(argv[++i], 10);
    else if (argv[i] === "--to" && argv[i + 1]) to = parseInt(argv[++i], 10);
    else if (argv[i] === "--force") force = true;
    else if (argv[i] === "--remove") remove = true;
  }
  return { steps, to, force, remove };
}

function removeFiles(
  drizzleDir: string,
  entry: JournalEntry,
  journal: Journal,
): string[] {
  const removed: string[] = [];

  for (const p of [
    path.join(drizzleDir, `${entry.tag}.sql`),
    path.join(drizzleDir, `${entry.tag}.down.sql`),
  ]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed.push(path.basename(p));
    }
  }

  const snapshot = findSnapshotFile(drizzleDir, entry.tag);
  if (snapshot && fs.existsSync(snapshot)) {
    fs.unlinkSync(snapshot);
    removed.push(`meta/${path.basename(snapshot)}`);
  }

  journal.entries = journal.entries.filter((e) => e.idx !== entry.idx);
  writeFileAtomic(journalPath(drizzleDir), JSON.stringify(journal, null, 2) + "\n");
  removed.push("meta/_journal.json (updated)");

  return removed;
}

export async function rollback(drizzleDir: string, argv: string[]): Promise<void> {
  const { steps, to, force, remove } = parseArgs(argv);
  const journal = readJournal(drizzleDir);
  const db = createPostgresAdapter();

  if (journal.entries.length === 0) {
    console.log("No migrations in journal.");
    await db.close();
    return;
  }

  let appliedTimestamps: Set<string>;
  try {
    const rows = await db.query<{ created_at: string }>(
      `SELECT created_at FROM ${POSTGRES_MIGRATIONS_TABLE} ORDER BY created_at DESC`,
    );
    appliedTimestamps = new Set(rows.map((r) => r.created_at));
  } catch (err) {
    if (!db.isUndefinedTableError(err)) throw err;
    console.log("No drizzle.__drizzle_migrations table found. Nothing is applied.");
    await db.close();
    return;
  }

  const applied = journal.entries.filter((e) =>
    appliedTimestamps.has(String(e.when)),
  );
  if (applied.length === 0) {
    console.log("No applied migrations found in the database.");
    await db.close();
    return;
  }

  const targets =
    to !== null
      ? applied.filter((e) => e.idx > to).sort((a, b) => b.idx - a.idx)
      : applied.sort((a, b) => b.idx - a.idx).slice(0, steps);

  if (targets.length === 0) {
    console.log("No migrations to roll back.");
    await db.close();
    return;
  }

  const missingDown = targets.filter(
    (e) => !fs.existsSync(path.join(drizzleDir, `${e.tag}.down.sql`)),
  );
  if (missingDown.length > 0) {
    console.log("Missing down.sql files for:");
    for (const e of missingDown) console.log(`  - ${e.tag}`);
    console.log("\nRun 'drizzle-down generate' first.");
    await db.close();
    process.exit(1);
  }

  console.log(
    `The following migrations will be ${remove ? "rolled back and REMOVED" : "rolled back"}:\n`,
  );
  for (const entry of targets) {
    const sql = fs.readFileSync(
      path.join(drizzleDir, `${entry.tag}.down.sql`),
      "utf-8",
    );
    const destructive = sql.includes("DROP TABLE") || sql.includes("DROP COLUMN");
    console.log(
      `  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}${destructive ? " (contains destructive operations)" : ""}`,
    );
  }
  if (remove) {
    console.log("\n  Migration files, down files and snapshots will be deleted.");
  }
  console.log("");

  if (!force && !(await confirm("Proceed with rollback?"))) {
    console.log("Rollback cancelled.");
    await db.close();
    return;
  }
  if (!force) console.log("");

  for (const entry of targets) {
    const sql = fs.readFileSync(
      path.join(drizzleDir, `${entry.tag}.down.sql`),
      "utf-8",
    );
    const statements = sql
      .split(BREAKPOINT)
      .map((s) => s.trim().replace(/;$/, "").trim())
      .filter((s) => s.length > 0);

    console.log(`Rolling back ${entry.tag}...`);

    try {
      await db.transaction(async (tx) => {
        for (const stmt of statements) await tx.execute(stmt);
        await tx.execute(
          `DELETE FROM ${POSTGRES_MIGRATIONS_TABLE} WHERE created_at = $1`,
          [String(entry.when)],
        );
      });
      console.log(`  Rolled back successfully (${statements.length} statements)`);
    } catch (err) {
      console.error(`  FAILED to roll back ${entry.tag}:`);
      console.error(`  ${err}`);
      console.log("\n  Transaction rolled back. The database is unchanged for this migration.");
      await db.close();
      process.exit(1);
    }
  }

  if (remove) {
    console.log("\nRemoving migration files...");
    for (const entry of targets) {
      console.log(`  ${entry.tag}: deleted ${removeFiles(drizzleDir, entry, journal).join(", ")}`);
    }
  }

  console.log(`\nDone. Rolled back ${targets.length} migration(s).`);
  console.log(
    remove
      ? "Migration files removed. Run 'drizzle-kit generate' to create new ones."
      : "Run 'drizzle-kit migrate' to re-apply when ready.",
  );

  await db.close();
}
