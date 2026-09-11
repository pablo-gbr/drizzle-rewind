import * as fs from "fs";
import * as path from "path";

import { diffSnapshots } from "../diff";
import { resolveDialect } from "../dialects/resolve";
import { EXIT } from "../exit-codes";
import {
  BREAKPOINT,
  findSnapshotFile,
  readJSON,
  readJournal,
} from "../journal";
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
  const json = format === "json";

  if (format !== "sql" && format !== "json") {
    console.error(`Unsupported format: ${format}`);
    process.exit(EXIT.INVALID_USAGE);
  }

  const journal = readJournal(drizzleDir);
  const dialect = resolveDialect(
    dialectFlagPos !== -1 ? argv[dialectFlagPos + 1] : journal.dialect,
  );
  if (!json) console.log(`Found ${journal.entries.length} migrations in journal\n`);

  const entries =
    targetIdx !== null
      ? journal.entries.filter((e) => e.idx === targetIdx)
      : journal.entries;

  if (entries.length === 0) {
    if (json) console.log(JSON.stringify({ dialect: dialect.name, migrations: [] }, null, 2));
    else console.log("No migrations to process.");
    return;
  }

  if (output && entries.length !== 1) {
    console.error("--output can only be used when exactly one migration is selected.");
    process.exit(EXIT.INVALID_USAGE);
  }

  let generated = 0;
  let skipped = 0;
  const generatedMigrations: GeneratedMigration[] = [];

  for (const entry of entries) {
    const downPath = path.join(drizzleDir, `${entry.tag}.down.sql`);

    // Never silently overwrite a hand-edited down file. Target it with --idx
    // if you really want it regenerated.
    if (targetIdx === null && fs.existsSync(downPath)) {
      skipped++;
      continue;
    }

    if (!json) console.log(`Generating down.sql for ${entry.tag} (idx: ${entry.idx})...`);

    const currentPath = findSnapshotFile(drizzleDir, entry.tag);
    if (!currentPath) {
      console.error(`  ERROR: snapshot not found for idx ${entry.idx}`);
      continue;
    }
    const current = readJSON<Snapshot>(currentPath);

    let previous: Snapshot;
    if (entry.idx === 0) {
      previous = emptySnapshot();
    } else {
      const prevEntry = journal.entries.find((e) => e.idx === entry.idx - 1);
      if (!prevEntry) {
        console.error(`  ERROR: journal entry ${entry.idx - 1} not found`);
        continue;
      }
      const prevPath = findSnapshotFile(drizzleDir, prevEntry.tag);
      if (!prevPath) {
        console.error(`  ERROR: snapshot not found for tag ${prevEntry.tag}`);
        continue;
      }
      previous = readJSON<Snapshot>(prevPath);
    }

    const { statements, riskWarnings } = diffSnapshots(current, previous, dialect);
    const riskyWarnings = printableWarnings(riskWarnings);
    for (const w of riskyWarnings) {
      if (!json) console.log(`  WARNING: ${w.message}`);
    }

    const summary = summarizeWarnings(riskWarnings);
    if (summary.unsupported > 0) {
      console.error("Unsupported rollback operations were detected.");
      process.exit(EXIT.UNSUPPORTED);
    }
    if (
      failOnDataLoss &&
      (summary["data-loss"] > 0 || summary["irreversible-data-loss"] > 0)
    ) {
      console.error("Rollback generation failed because data-loss warnings were detected.");
      process.exit(EXIT.UNSAFE_ROLLBACK);
    }
    if (failOnWarning && riskyWarnings.length > 0) {
      console.error("Rollback generation failed because warnings were detected.");
      process.exit(EXIT.UNSAFE_ROLLBACK);
    }

    if (statements.length === 0) {
      if (!json) console.log("  No changes detected, skipping");
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
      fs.writeFileSync(
        destination,
        warningComments(riskyWarnings) + statements.join(`;${BREAKPOINT}\n`) + ";\n",
      );
      console.log(
        `  Written: ${path.relative(process.cwd(), destination)} (${statements.length} statements)`,
      );
    }
    generated++;
  }

  if (json) {
    console.log(JSON.stringify({ dialect: dialect.name, migrations: generatedMigrations }, null, 2));
  } else {
    console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}`);
  }
}
