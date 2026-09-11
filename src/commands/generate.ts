import * as fs from "fs";
import * as path from "path";

import { diffSnapshots } from "../diff";
import { resolveDialect } from "../dialects/resolve";
import {
  BREAKPOINT,
  findSnapshotFile,
  readJSON,
  readJournal,
} from "../journal";
import { emptySnapshot, type Snapshot } from "../snapshot";

export function generate(drizzleDir: string, argv: string[]): void {
  let targetIdx: number | null = null;
  const idxFlagPos = argv.indexOf("--idx");
  if (idxFlagPos !== -1 && argv[idxFlagPos + 1]) {
    targetIdx = parseInt(argv[idxFlagPos + 1], 10);
  }
  const dialectFlagPos = argv.indexOf("--dialect");
  const dialect = resolveDialect(
    dialectFlagPos !== -1 ? argv[dialectFlagPos + 1] : undefined,
  );

  const journal = readJournal(drizzleDir);
  console.log(`Found ${journal.entries.length} migrations in journal\n`);

  const entries =
    targetIdx !== null
      ? journal.entries.filter((e) => e.idx === targetIdx)
      : journal.entries;

  if (entries.length === 0) {
    console.log("No migrations to process.");
    return;
  }

  let generated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const downPath = path.join(drizzleDir, `${entry.tag}.down.sql`);

    // Never silently overwrite a hand-edited down file. Target it with --idx
    // if you really want it regenerated.
    if (targetIdx === null && fs.existsSync(downPath)) {
      skipped++;
      continue;
    }

    console.log(`Generating down.sql for ${entry.tag} (idx: ${entry.idx})...`);

    const currentPath = findSnapshotFile(drizzleDir, entry.tag);
    if (!currentPath) {
      console.log(`  ERROR: snapshot not found for idx ${entry.idx}`);
      continue;
    }
    const current = readJSON<Snapshot>(currentPath);

    let previous: Snapshot;
    if (entry.idx === 0) {
      previous = emptySnapshot();
    } else {
      const prevEntry = journal.entries.find((e) => e.idx === entry.idx - 1);
      if (!prevEntry) {
        console.log(`  ERROR: journal entry ${entry.idx - 1} not found`);
        continue;
      }
      const prevPath = findSnapshotFile(drizzleDir, prevEntry.tag);
      if (!prevPath) {
        console.log(`  ERROR: snapshot not found for tag ${prevEntry.tag}`);
        continue;
      }
      previous = readJSON<Snapshot>(prevPath);
    }

    const { statements, warnings } = diffSnapshots(current, previous, dialect);
    for (const w of warnings) console.log(`  WARNING: ${w}`);

    if (statements.length === 0) {
      console.log("  No changes detected, skipping");
      skipped++;
      continue;
    }

    fs.writeFileSync(downPath, statements.join(`;${BREAKPOINT}\n`) + ";\n");
    console.log(
      `  Written: ${path.relative(process.cwd(), downPath)} (${statements.length} statements)`,
    );
    generated++;
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}`);
}
