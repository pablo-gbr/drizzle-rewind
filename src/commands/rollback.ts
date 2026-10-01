import * as fs from "fs";
import * as path from "path";

import { color } from "../cli-colors";
import { logDatabaseUrlDiagnostic } from "../config";
import { createDatabaseAdapter, dialectArg } from "../db/factory";
import { resolveDialect } from "../dialects/resolve";
import { EXIT } from "../exit-codes";
import {
  confirm,
  findSnapshotFile,
  journalPath,
  readJournal,
  writeFileAtomic,
  type Journal,
  type JournalEntry,
} from "../journal";
import { migrationsTableDisplayName, type DatabaseAdapter } from "../db/adapter";
import {
  buildRollbackPlan,
  printMariaDbDDLWarning,
  printRollbackPlan,
  type RollbackPlanMigration,
} from "./rollback-plan";
import { assertRollbackAllowed, printableWarnings } from "../safety/classify";

function parseArgs(argv: string[]) {
  let steps = 1;
  let to: number | null = null;
  let force = false;
  let remove = false;
  let allowDataLoss = false;
  let allowIrreversibleDataLoss = false;
  let dryRun = false;
  let continueOnError = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--steps" && argv[i + 1]) steps = parseInt(argv[++i], 10);
    else if (argv[i] === "--to" && argv[i + 1]) to = parseInt(argv[++i], 10);
    else if (argv[i] === "--force" || argv[i] === "--yes") force = true;
    else if (argv[i] === "--remove") remove = true;
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--continue-on-error") continueOnError = true;
    else if (argv[i] === "--allow-data-loss") allowDataLoss = true;
    else if (argv[i] === "--allow-irreversible-data-loss") {
      allowDataLoss = true;
      allowIrreversibleDataLoss = true;
    }
  }
  return {
    steps,
    to,
    force,
    remove,
    allowDataLoss,
    allowIrreversibleDataLoss,
    dryRun,
    continueOnError,
  };
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
  const {
    steps,
    to,
    force,
    remove,
    allowDataLoss,
    allowIrreversibleDataLoss,
    dryRun,
    continueOnError,
  } = parseArgs(argv);
  const journal = readJournal(drizzleDir);
  const dialect = resolveDialect(dialectArg(argv));
  const db = createDatabaseAdapter(argv);

  if (journal.entries.length === 0) {
    console.log(color("green", "No migrations in journal."));
    await db.close();
    return;
  }

  let appliedTimestamps: Set<string>;
  try {
    const rows = await db.query<{ created_at: string }>(
      `SELECT created_at FROM ${db.migrationsTable} ORDER BY created_at DESC`,
    );
    appliedTimestamps = new Set(rows.map((r) => String(r.created_at)));
  } catch (err) {
    if (!db.isUndefinedTableError(err)) {
      logDatabaseUrlDiagnostic();
      throw err;
    }
    console.log(`${color("yellow", "No tracking table:")} ${migrationsTableDisplayName(db)}. Nothing is applied.`);
    await db.close();
    return;
  }

  const applied = journal.entries.filter((e) =>
    appliedTimestamps.has(String(e.when)),
  );
  if (applied.length === 0) {
    console.log(color("green", "No applied migrations found in the database."));
    await db.close();
    return;
  }

  const targets =
    to !== null
      ? applied.filter((e) => e.idx > to).sort((a, b) => b.idx - a.idx)
      : applied.sort((a, b) => b.idx - a.idx).slice(0, steps);

  if (targets.length === 0) {
    console.log(color("green", "No migrations to roll back."));
    await db.close();
    return;
  }

  const missingDown = targets.filter(
    (e) => !fs.existsSync(path.join(drizzleDir, `${e.tag}.down.sql`)),
  );
  if (missingDown.length > 0) {
    console.log(color("red", "Missing down.sql files for:"));
    for (const e of missingDown) console.log(`  - ${e.tag}`);
    console.log(`\n${color("cyan", "Run")} 'drizzle-rewind generate' first.`);
    await db.close();
    process.exit(EXIT.GENERIC);
  }

  const toTag = rollbackTargetTag(journal.entries, targets);
  const plan = buildRollbackPlan(drizzleDir, dialect.name, targets, toTag);

  printRollbackPlan(plan);

  if (dryRun) {
    console.log(color("green", "\nDry run only. No database changes were made."));
    await db.close();
    return;
  }

  try {
    assertRollbackAllowed(plan.warnings, {
      allowDataLoss,
      allowIrreversibleDataLoss,
    });
  } catch (err) {
    for (const warning of printableWarnings(plan.warnings)) {
      console.error(`${color("yellow", "WARNING:")} ${warning.message}`);
    }
    console.error(color("red", (err as Error).message));
    await db.close();
    process.exit(
      plan.warnings.some((w) => w.level === "unsupported")
        ? EXIT.UNSUPPORTED
        : EXIT.UNSAFE_ROLLBACK,
    );
  }

  if (dialect.name === "mysql") {
    printMariaDbDDLWarning(plan.statements.length);
  }

  console.log(
    `${color("yellow", "The following migrations will be")} ${remove ? color("red", "rolled back and REMOVED") : "rolled back"}:\n`,
  );
  for (const migration of plan.migrations) {
    const entry = migration.entry;
    const destructive = printableWarnings(migration.warnings).length > 0;
    console.log(
      `  [${String(entry.idx).padStart(4, "0")}] ${entry.tag}${destructive ? color("yellow", " (contains destructive operations)") : ""}`,
    );
  }
  if (remove) {
    console.log(color("red", "\n  Migration files, down files and snapshots will be deleted."));
  }
  console.log("");

  if (!force && !(await confirm("Proceed with rollback?"))) {
    console.log(color("yellow", "Rollback cancelled."));
    await db.close();
    return;
  }
  if (!force) console.log("");

  let failed = false;
  for (const migration of plan.migrations) {
    failed =
      dialect.name === "mysql"
        ? (await executeMySqlMigration(db, migration, continueOnError)) || failed
        : (await executeTransactionalMigration(db, migration)) || failed;

    if (failed && !continueOnError) {
      await db.close();
      process.exit(EXIT.DATABASE_EXECUTION_FAILED);
    }
  }

  if (failed) {
    await db.close();
    process.exit(EXIT.DATABASE_EXECUTION_FAILED);
  }

  if (remove) {
    console.log(color("yellow", "\nRemoving migration files..."));
    for (const entry of targets) {
      console.log(`  ${entry.tag}: deleted ${removeFiles(drizzleDir, entry, journal).join(", ")}`);
    }
  }

  console.log(`\n${color("green", "Done.")} Rolled back ${targets.length} migration(s).`);
  console.log(
    remove
      ? "Migration files removed. Run 'drizzle-kit generate' to create new ones."
      : "Run 'drizzle-kit migrate' to re-apply when ready.",
  );

  await db.close();
}

function rollbackTargetTag(entries: JournalEntry[], targets: JournalEntry[]): string {
  const last = targets[targets.length - 1];
  if (!last) return "";
  return entries.find((e) => e.idx === last.idx - 1)?.tag ?? "base";
}

async function executeTransactionalMigration(
  db: DatabaseAdapter,
  migration: RollbackPlanMigration,
): Promise<boolean> {
  const entry = migration.entry;
  console.log(`${color("cyan", "Rolling back")} ${entry.tag}...`);

  try {
    await db.transaction(async (tx) => {
      for (const stmt of migration.statements) await tx.execute(stmt);
      await deleteMigrationTracking(tx, entry);
    });
    console.log(`  ${color("green", "Rolled back successfully")} (${migration.statements.length} statements)`);
    return false;
  } catch (err) {
    console.error(color("red", `  FAILED to roll back ${entry.tag}:`));
    console.error(`  ${err}`);
    console.log(color("green", "\n  Transaction rolled back. The database is unchanged for this migration."));
    return true;
  }
}

async function executeMySqlMigration(
  db: DatabaseAdapter,
  migration: RollbackPlanMigration,
  continueOnError: boolean,
): Promise<boolean> {
  const entry = migration.entry;
  const applied: string[] = [];
  const failed: Array<{ index: number; statement: string; err: unknown }> = [];

  console.log(`${color("cyan", "Rolling back")} ${entry.tag}...`);

  for (let i = 0; i < migration.statements.length; i++) {
    const statement = migration.statements[i];
    try {
      await db.execute(statement);
      applied.push(statement);
    } catch (err) {
      failed.push({ index: i + 1, statement, err });
      printPartialFailure(migration.statements.length, applied, failed[0]);
      if (!continueOnError) return true;
    }
  }

  if (failed.length > 0) {
    console.log(color("yellow", `  Tracking was not updated for ${entry.tag}.`));
    return true;
  }

  try {
    await deleteMigrationTracking(db, entry);
  } catch (err) {
    console.error(color("red", `  FAILED to update migration tracking for ${entry.tag}:`));
    console.error(`  ${err}`);
    console.error(
      color("red", "  Schema statements completed, but tracking was not updated for this migration."),
    );
    return true;
  }
  console.log(`  ${color("green", "Rolled back successfully")} (${migration.statements.length} statements)`);
  return false;
}

async function deleteMigrationTracking(
  db: DatabaseAdapter,
  entry: JournalEntry,
): Promise<void> {
  await db.execute(
    `DELETE FROM ${db.migrationsTable} WHERE created_at = ${db.placeholder(1)}`,
    [String(entry.when)],
  );
}

function printPartialFailure(
  total: number,
  applied: string[],
  failed: { index: number; statement: string; err: unknown },
): void {
  console.error(color("red", `Rollback failed on statement ${failed.index}/${total}.`));
  if (applied.length > 0) {
    console.error(color("green", "\nApplied successfully:"));
    applied.forEach((stmt, i) => console.error(`  ${i + 1}. ${oneLine(stmt)}`));
  }
  console.error(color("red", "\nFailed:"));
  console.error(`  ${failed.index}. ${oneLine(failed.statement)}`);
  console.error(`  ${failed.err}`);
  console.error(
    color("yellow", "\nMariaDB DDL may already be committed. Earlier statements may not be automatically reversible."),
  );
}

function oneLine(sql: string): string {
  return sql.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
}
