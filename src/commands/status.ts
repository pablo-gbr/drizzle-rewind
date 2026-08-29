import * as fs from "fs";
import * as path from "path";

import { MIGRATIONS_TABLE, UNDEFINED_TABLE, createPool } from "../config";
import { readJournal, type DbRow } from "../journal";

export async function status(drizzleDir: string, argv: string[]): Promise<void> {
  // --strict exits 1 while anything is pending, so a deploy pipeline fails
  // instead of shipping code whose migrations were silently skipped. Orphans
  // stay informational: a row from an unmerged branch is legitimate on a
  // shared database.
  const strict = argv.includes("--strict");
  const journal = readJournal(drizzleDir);
  const pool = createPool();

  let dbRows: DbRow[] = [];
  try {
    const result = await pool.query(
      `SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at ASC`,
    );
    dbRows = result.rows;
  } catch (err) {
    if ((err as { code?: string }).code !== UNDEFINED_TABLE) throw err;

    console.log("No drizzle.__drizzle_migrations table found.\n");
    console.log("All migrations are pending:\n");
    for (const entry of journal.entries) {
      console.log(`  [pending]  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}`);
    }
    console.log(`\nApplied: 0 | Pending: ${journal.entries.length} | Orphans: 0`);
    await pool.end();
    if (strict && journal.entries.length > 0) process.exit(1);
    return;
  }

  const appliedTimestamps = new Set(dbRows.map((r) => r.created_at));
  const journalTimestamps = new Set(journal.entries.map((e) => String(e.when)));

  let applied = 0;
  let pending = 0;

  console.log("Migration status:\n");

  for (const entry of journal.entries) {
    const isApplied = appliedTimestamps.has(String(entry.when));
    isApplied ? applied++ : pending++;

    const hasDown = fs.existsSync(path.join(drizzleDir, `${entry.tag}.down.sql`));
    console.log(
      `  [${isApplied ? "applied" : "pending"}]  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}${hasDown ? "" : " (no down.sql)"}`,
    );
  }

  const orphans = dbRows.filter((r) => !journalTimestamps.has(r.created_at));
  if (orphans.length > 0) {
    console.log("");
    for (const o of orphans) {
      console.log(
        `  [orphan]   id=${o.id} hash=${o.hash.substring(0, 16)}... created_at=${o.created_at}, not in journal`,
      );
    }
  }

  console.log(
    `\nApplied: ${applied} | Pending: ${pending} | Orphans: ${orphans.length}`,
  );
  if (orphans.length > 0) {
    console.log("\nRun 'drizzle-down repair --clean-orphans' to remove orphan rows.");
  }
  if (pending > 0) {
    console.log("\nRun 'drizzle-kit migrate' to apply pending migrations.");
  }

  await pool.end();
  if (strict && pending > 0) process.exit(1);
}
