// Programmatic API. Every CLI command is callable from code, so a project can
// wire rollback into its own tooling instead of shelling out.
export { generate } from "./commands/generate";
export { status } from "./commands/status";
export { rollback } from "./commands/rollback";
export { repair } from "./commands/repair";

export { diffSnapshots, type DiffResult } from "./diff";
export { emptySnapshot, type Snapshot, type TableDef } from "./snapshot";
export { resolveDrizzleDir, createPool } from "./config";
export {
  readJournal,
  findSnapshotFile,
  BREAKPOINT,
  type Journal,
  type JournalEntry,
} from "./journal";
