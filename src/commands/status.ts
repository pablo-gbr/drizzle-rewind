import * as fs from "fs";
import * as path from "path";

import { migrationsTableDisplayName } from "../db/adapter";
import { createDatabaseAdapter } from "../db/factory";
import {
  migrationHash,
  readJournal,
  type DbRow,
  type JournalEntry,
} from "../journal";

interface HashMismatch {
  entry: JournalEntry;
  path: string;
  expected: string;
  actual: string | null;
}

export function findHashMismatches(
  drizzleDir: string,
  entries: JournalEntry[],
  dbRows: DbRow[],
): HashMismatch[] {
  const rowsByTimestamp = new Map(dbRows.map((r) => [String(r.created_at), r]));
  const mismatches: HashMismatch[] = [];

  for (const entry of entries) {
    const row = rowsByTimestamp.get(String(entry.when));
    if (!row) continue;

    const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
    const expected = fs.existsSync(sqlPath) ? migrationHash(sqlPath) : "";
    const actual = row.hash ? String(row.hash) : null;
    if (expected !== actual) {
      mismatches.push({ entry, path: sqlPath, expected, actual });
    }
  }

  return mismatches;
}

export async function status(drizzleDir: string, argv: string[]): Promise<void> {
  // --strict exits 1 while anything is pending, so a deploy pipeline fails
  // instead of shipping code whose migrations were silently skipped. Orphans
  // stay informational: a row from an unmerged branch is legitimate on a
  // shared database.
  const strict = argv.includes("--strict");
  const journal = readJournal(drizzleDir);
  const db = createDatabaseAdapter(argv);

  let dbRows: DbRow[] = [];
  try {
    dbRows = await db.query<DbRow>(
      `SELECT id, hash, created_at FROM ${db.migrationsTable} ORDER BY created_at ASC`,
    );
  } catch (err) {
    if (!db.isUndefinedTableError(err)) throw err;

    console.log(`No ${migrationsTableDisplayName(db)} table found.\n`);
    console.log("All migrations are pending:\n");
    for (const entry of journal.entries) {
      console.log(`  [pending]  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}`);
    }
    console.log(`\nApplied: 0 | Pending: ${journal.entries.length} | Orphans: 0`);
    await db.close();
    if (strict && journal.entries.length > 0) process.exit(1);
    return;
  }

  const appliedTimestamps = new Set(dbRows.map((r) => String(r.created_at)));
  const journalTimestamps = new Set(journal.entries.map((e) => String(e.when)));
  const hashMismatches = findHashMismatches(drizzleDir, journal.entries, dbRows);
  const mismatchIdx = new Set(hashMismatches.map((m) => m.entry.idx));

  let applied = 0;
  let pending = 0;

  console.log("Migration status:\n");
  console.log(`Dialect: ${db.dialect}\n`);

  for (const entry of journal.entries) {
    const isApplied = appliedTimestamps.has(String(entry.when));
    isApplied ? applied++ : pending++;

    const hasDown = fs.existsSync(path.join(drizzleDir, `${entry.tag}.down.sql`));
    const hashNote = mismatchIdx.has(entry.idx) ? " (hash mismatch)" : "";
    console.log(
      `  [${isApplied ? "applied" : "pending"}]  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}${hashNote}${hasDown ? "" : " (no down.sql)"}`,
    );
  }

  const orphans = dbRows.filter((r) => !journalTimestamps.has(String(r.created_at)));
  if (orphans.length > 0) {
    console.log("");
    for (const o of orphans) {
      console.log(
        `  [orphan]   id=${o.id} hash=${o.hash.substring(0, 16)}... created_at=${o.created_at}, not in journal`,
      );
    }
  }

  if (hashMismatches.length > 0) {
    console.log("");
    for (const m of hashMismatches) {
      console.log(
        `  [hash-mismatch] [${String(m.entry.idx).padStart(4, "0")}] ${m.entry.tag} db=${(m.actual ?? "missing").substring(0, 16)}... file=${(m.expected || "missing").substring(0, 16)}...`,
      );
    }
  }

  console.log(
    `\nApplied: ${applied} | Pending: ${pending} | Orphans: ${orphans.length} | Hash mismatches: ${hashMismatches.length}`,
  );
  if (orphans.length > 0) {
    console.log("\nRun 'drizzle-rewind repair --clean-orphans' to remove orphan rows.");
  }
  if (pending > 0) {
    console.log("\nRun 'drizzle-kit migrate' to apply pending migrations.");
  }
  if (hashMismatches.length > 0) {
    console.log("\nHash mismatches mean an applied migration file differs from the database migration log.");
  }

  await db.close();
  if (strict && (pending > 0 || hashMismatches.length > 0)) process.exit(1);
}
