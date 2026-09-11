#!/usr/bin/env node
import { resolveDrizzleDir } from "./config";
import { generate } from "./commands/generate";
import { repair } from "./commands/repair";
import { rollback } from "./commands/rollback";
import { status } from "./commands/status";

const USAGE = `drizzle-rewind - down migrations, rollback, status and repair for Drizzle ORM

Usage: drizzle-rewind <command> [options]

Commands:
  generate    Write <tag>.down.sql for every migration that lacks one
  status      Show applied, pending and orphan migrations
  rollback    Run down migrations against the database
  repair      Fix the tracking table without running migration SQL

Common options:
  --dir <path>   Migration output directory (default: drizzle.config.ts "out", else ./drizzle)

generate:
  --idx <n>      Regenerate one migration, overwriting an existing down file
  --dialect <postgres|mysql|mariadb>

status:
  --strict       Exit 1 if anything is pending (for CI and deploy pipelines)
  --dialect <postgres|mysql|mariadb>

rollback:
  --steps <n>    How many migrations to undo (default 1)
  --to <idx>     Undo everything above this journal index
  --dialect <postgres|mysql|mariadb>
  --remove       Also delete the migration, down and snapshot files
  --force        Skip the confirmation prompt

repair:
  --mark-applied <idx>   Mark one migration applied without running its SQL
  --baseline             Mark every pending migration applied
  --clean-orphans        Delete tracking rows that are not in the journal
  --dialect <postgres|mysql|mariadb>
  --force                Skip the confirmation prompt

DATABASE_URL must be set for status, rollback and repair.
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  const drizzleDir = resolveDrizzleDir(rest);

  switch (command) {
    case "generate":
      return generate(drizzleDir, rest);
    case "status":
      return status(drizzleDir, rest);
    case "rollback":
      return rollback(drizzleDir, rest);
    case "repair":
      return repair(drizzleDir, rest);
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
