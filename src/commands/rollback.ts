import * as fs from "fs";
import * as path from "path";

import { MIGRATIONS_TABLE, UNDEFINED_TABLE, createPool } from "../config";
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
  const pool = createPool();

  if (journal.entries.length === 0) {
    console.log("No migrations in journal.");
    await pool.end();
    return;
  }

  let appliedTimestamps: Set<string>;
  try {
    const result = await pool.query(
      `SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC`,
    );
    appliedTimestamps = new Set(
      result.rows.map((r: { created_at: string }) => r.created_at),
    );
  } catch (err) {
    if ((err as { code?: string }).code !== UNDEFINED_TABLE) throw err;
    console.log("No drizzle.__drizzle_migrations table found. Nothing is applied.");
    await pool.end();
    return;
  }

  const applied = journal.entries.filter((e) =>
    appliedTimestamps.has(String(e.when)),
  );
  if (applied.length === 0) {
    console.log("No applied migrations found in the database.");
    await pool.end();
    return;
  }

  const targets =
    to !== null
      ? applied.filter((e) => e.idx > to).sort((a, b) => b.idx - a.idx)
      : applied.sort((a, b) => b.idx - a.idx).slice(0, steps);

  if (targets.length === 0) {
    console.log("No migrations to roll back.");
    await pool.end();
    return;
  }

  const missingDown = targets.filter(
    (e) => !fs.existsSync(path.join(drizzleDir, `${e.tag}.down.sql`)),
  );
  if (missingDown.length > 0) {
    console.log("Missing down.sql files for:");
    for (const e of missingDown) console.log(`  - ${e.tag}`);
    console.log("\nRun 'drizzle-down generate' first.");
    await pool.end();
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
    await pool.end();
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const stmt of statements) await client.query(stmt);
      await client.query(
        `DELETE FROM ${MIGRATIONS_TABLE} WHERE created_at = $1`,
        [String(entry.when)],
      );
      await client.query("COMMIT");
      console.log(`  Rolled back successfully (${statements.length} statements)`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAILED to roll back ${entry.tag}:`);
      console.error(`  ${err}`);
      console.log("\n  Transaction rolled back. The database is unchanged for this migration.");
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
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

  await pool.end();
}
