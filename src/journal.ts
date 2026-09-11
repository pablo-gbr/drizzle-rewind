import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface DbRow {
  id: number;
  hash: string;
  created_at: string | number;
}

export const BREAKPOINT = "--> statement-breakpoint";

export const metaDir = (drizzleDir: string) => path.join(drizzleDir, "meta");
export const journalPath = (drizzleDir: string) =>
  path.join(metaDir(drizzleDir), "_journal.json");

export function readJSON<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function readJournal(drizzleDir: string): Journal {
  const p = journalPath(drizzleDir);
  if (!fs.existsSync(p)) {
    console.error(
      `No migration journal at ${p}.\nPass --dir, set DRIZZLE_DIR, or run from the directory holding drizzle.config.ts.`,
    );
    process.exit(1);
  }
  return readJSON<Journal>(p);
}

/** The numeric prefix a migration tag's snapshot is keyed by (`0123`, `20260821113522`), or null if the tag has none. */
export function snapshotPrefix(tag: string): string | null {
  return tag.match(/^(\d+)_/)?.[1] ?? null;
}

export function findSnapshotFile(drizzleDir: string, tag: string): string | null {
  const prefix = snapshotPrefix(tag);
  if (!prefix) return null;
  const dir = metaDir(drizzleDir);
  if (!fs.existsSync(dir)) return null;
  const match = fs
    .readdirSync(dir)
    .find((f) => f.startsWith(prefix + "_") && f.endsWith("_snapshot.json"));
  return match ? path.join(dir, match) : null;
}

/** Write via temp + rename so a crash mid-write cannot corrupt the journal. */
export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

export function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}
