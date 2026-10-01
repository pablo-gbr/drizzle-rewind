import * as fs from "fs";
import * as path from "path";

import { color } from "../cli-colors";
import { diffSnapshots } from "../diff";
import { isUnsupportedDialectOperationError } from "../dialects/dialect";
import { resolveDialect } from "../dialects/resolve";
import { SQLiteDialect } from "../dialects/sqlite";
import { EXIT } from "../exit-codes";
import {
  BREAKPOINT,
  findSnapshotFile,
  readJSON,
  readJournal,
  type JournalEntry,
} from "../journal";
import {
  applyMySqlForwardNames,
  mergeMySqlForwardNames,
  parseMySqlForwardNames,
} from "../mysql-forward-names";
import { printableWarnings, summarizeWarnings } from "../safety/classify";
import { warningComments } from "../safety/sql";
import type { RollbackWarning } from "../safety/types";
import { emptySnapshot, type Snapshot } from "../snapshot";

interface GeneratedMigration {
  dialect: string;
  idx: number;
  tag: string;
  statements: string[];
  warnings: RollbackWarning[];
}

export function generate(drizzleDir: string, argv: string[]): void {
  let targetIdx: number | null = null;
  const idxFlagPos = argv.indexOf("--idx");
  if (idxFlagPos !== -1 && argv[idxFlagPos + 1]) {
    targetIdx = parseInt(argv[idxFlagPos + 1], 10);
  }
  const dialectFlagPos = argv.indexOf("--dialect");
  const format = argv.includes("--format")
    ? argv[argv.indexOf("--format") + 1]
    : "sql";
  const output = argv.includes("--output")
    ? argv[argv.indexOf("--output") + 1]
    : null;
  const failOnWarning = argv.includes("--fail-on-warning");
  const failOnDataLoss = argv.includes("--fail-on-data-loss");
  const check = argv.includes("--check");
  const json = format === "json";

  if (format !== "sql" && format !== "json") {
    console.error(color("red", `Unsupported format: ${format}`));
    process.exit(EXIT.INVALID_USAGE);
  }
  if (check && json) {
    console.error(color("red", "--check cannot be used with --format json."));
    process.exit(EXIT.INVALID_USAGE);
  }

  const journal = readJournal(drizzleDir);
  let dialect = resolveDialect(
    dialectFlagPos !== -1 ? argv[dialectFlagPos + 1] : journal.dialect,
  );
  if (dialect.name === "sqlite" && argv.includes("--allow-table-rebuild")) {
    dialect = new SQLiteDialect(true);
  }
  if (!json) {
    console.log(
      `${color("cyan", "Found")} ${journal.entries.length} migrations in journal\n`,
    );
  }

  const entries =
    targetIdx !== null
      ? journal.entries.filter((e) => e.idx === targetIdx)
      : journal.entries;

  if (entries.length === 0) {
    if (json) console.log(JSON.stringify({ dialect: dialect.name, migrations: [] }, null, 2));
    else console.log(color("green", "No migrations to process."));
    return;
  }

  if (output && entries.length !== 1) {
    console.error(
      color("red", "--output can only be used when exactly one migration is selected."),
    );
    process.exit(EXIT.INVALID_USAGE);
  }
  if (check && output) {
    console.error(color("red", "--output cannot be used with --check."));
    process.exit(EXIT.INVALID_USAGE);
  }

  let generated = 0;
  let skipped = 0;
  let checkFailed = false;
  const generatedMigrations: GeneratedMigration[] = [];

  for (const entry of entries) {
    const downPath = path.join(drizzleDir, `${entry.tag}.down.sql`);

    // Never silently overwrite a hand-edited down file. Target it with --idx
    // if you really want it regenerated.
    if (!check && targetIdx === null && fs.existsSync(downPath)) {
      skipped++;
      continue;
    }

    if (!json) {
      console.log(
        `${check ? "Checking" : "Generating"} down.sql for ${entry.tag} (idx: ${entry.idx})...`,
      );
    }

    const currentPath = findSnapshotFile(drizzleDir, entry.tag);
    if (!currentPath) {
      console.error(`  ${color("red", "ERROR:")} snapshot not found for idx ${entry.idx}`);
      if (check) checkFailed = true;
      continue;
    }
    let current = readJSON<Snapshot>(currentPath);

    let previous: Snapshot;
    if (entry.idx === 0) {
      previous = emptySnapshot();
    } else {
      const prevEntry = journal.entries.find((e) => e.idx === entry.idx - 1);
      if (!prevEntry) {
        console.error(`  ${color("red", "ERROR:")} journal entry ${entry.idx - 1} not found`);
        if (check) checkFailed = true;
        continue;
      }
      const prevPath = findSnapshotFile(drizzleDir, prevEntry.tag);
      if (!prevPath) {
        console.error(`  ${color("red", "ERROR:")} snapshot not found for tag ${prevEntry.tag}`);
        if (check) checkFailed = true;
        continue;
      }
      previous = readJSON<Snapshot>(prevPath);
    }

    if (dialect.name === "mysql") {
      current = applyMySqlForwardNames(
        current,
        readMySqlForwardNamesThrough(drizzleDir, journal.entries, entry.idx),
      );
      previous = applyMySqlForwardNames(
        previous,
        readMySqlForwardNamesThrough(drizzleDir, journal.entries, entry.idx - 1),
      );
    }

    let diffResult: ReturnType<typeof diffSnapshots>;
    try {
      diffResult = diffSnapshots(current, previous, dialect);
    } catch (err) {
      if (isUnsupportedDialectOperationError(err)) {
        console.error(
          color(
            "red",
            `Unsupported ${err.dialect} rollback operation in ${entry.tag}: ${err.operation}.`,
          ),
        );
        console.error(color("red", err.message));
        process.exit(EXIT.UNSUPPORTED);
      }
      throw err;
    }
    const { statements, riskWarnings } = diffResult;
    const riskyWarnings = printableWarnings(riskWarnings);
    for (const w of riskyWarnings) {
      if (!json) console.log(`  ${color("yellow", "WARNING:")} ${w.message}`);
    }

    const summary = summarizeWarnings(riskWarnings);
    if (summary.unsupported > 0) {
      console.error(color("red", "Unsupported rollback operations were detected."));
      process.exit(EXIT.UNSUPPORTED);
    }
    if (
      failOnDataLoss &&
      (summary["data-loss"] > 0 || summary["irreversible-data-loss"] > 0)
    ) {
      console.error(
        color("red", "Rollback generation failed because data-loss warnings were detected."),
      );
      process.exit(EXIT.UNSAFE_ROLLBACK);
    }
    if (failOnWarning && riskyWarnings.length > 0) {
      console.error(
        color("red", "Rollback generation failed because warnings were detected."),
      );
      process.exit(EXIT.UNSAFE_ROLLBACK);
    }

    if (statements.length === 0) {
      if (check && fs.existsSync(downPath)) {
        console.error(
          `  ${color("red", "STALE:")} ${path.relative(process.cwd(), downPath)} is present but no rollback SQL is generated`,
        );
        checkFailed = true;
      } else if (!json) console.log(`  ${color("gray", "No changes detected, skipping")}`);
      skipped++;
      continue;
    }

    generatedMigrations.push({
      dialect: dialect.name,
      idx: entry.idx,
      tag: entry.tag,
      statements,
      warnings: riskyWarnings,
    });

    if (!json) {
      const destination = output ? path.resolve(output) : downPath;
      const expectedSql = generatedSql(statements, riskyWarnings);
      if (check) {
        if (!fs.existsSync(destination)) {
          console.error(
            `  ${color("red", "MISSING:")} ${path.relative(process.cwd(), destination)}`,
          );
          checkFailed = true;
        } else if (fs.readFileSync(destination, "utf-8") !== expectedSql) {
          console.error(
            `  ${color("red", "STALE:")} ${path.relative(process.cwd(), destination)}`,
          );
          checkFailed = true;
        } else {
          console.log(
            `  ${color("green", "OK:")} ${path.relative(process.cwd(), destination)}`,
          );
        }
      } else {
        fs.writeFileSync(destination, expectedSql);
        console.log(
          `  ${color("green", "Written:")} ${path.relative(process.cwd(), destination)} (${statements.length} statements)`,
        );
      }
    }
    generated++;
  }

  if (checkFailed) {
    console.error(color("red", "\nDown migration check failed."));
    process.exit(EXIT.MIGRATION_STATE_MISMATCH);
  }

  if (json) {
    console.log(JSON.stringify({ dialect: dialect.name, migrations: generatedMigrations }, null, 2));
  } else {
    console.log(
      `\n${color("green", "Done.")} ${check ? "Checked" : "Generated"}: ${generated}, Skipped: ${skipped}`,
    );
  }
}

function generatedSql(statements: string[], warnings: RollbackWarning[]): string {
  return warningComments(warnings) + statements.join(`;${BREAKPOINT}\n`) + ";\n";
}

function readMySqlForwardNamesThrough(
  drizzleDir: string,
  entries: JournalEntry[],
  maxIdx: number,
) {
  return mergeMySqlForwardNames(
    entries
      .filter((e) => e.idx <= maxIdx)
      .map((e) => path.join(drizzleDir, `${e.tag}.sql`))
      .filter((p) => fs.existsSync(p))
      .map((p) => parseMySqlForwardNames(fs.readFileSync(p, "utf-8"))),
  );
}
