#!/usr/bin/env node
import { color } from "./cli-colors";
import { resolveDrizzleDir } from "./config";
import { generate } from "./commands/generate";
import { repair } from "./commands/repair";
import { rollback } from "./commands/rollback";
import { reset } from "./commands/reset";
import { status } from "./commands/status";

const USAGE = `drizzle-rewind - down migrations, rollback, status and repair for Drizzle ORM

Usage: drizzle-rewind <command> [options]

Commands:
  generate    Write <tag>.down.sql for every migration that lacks one
  status      Show applied, pending and orphan migrations
  rollback    Run down migrations against the database
  repair      Fix the tracking table without running migration SQL
  reset       Drop database objects, then run drizzle-kit push

Common options:
  --dir <path>   Migration output directory (default: drizzle.config.ts "out", else ./drizzle)
  --help, -h     Show this help message

generate:
  --idx <n>      Regenerate one migration, overwriting an existing down file
  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>
  --format <sql|json>
  --output <file>
  --check        Fail if generated down migrations are missing or stale
  --fail-on-warning
  --fail-on-data-loss
  --allow-table-rebuild    SQLite only: emit opt-in table rebuild SQL

status:
  --strict       Exit 1 if anything is pending (for CI and deploy pipelines)
  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>

rollback:
  --steps <n>    How many migrations to undo (default 1)
  --to <idx>     Undo everything above this journal index
  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>
  --dry-run      Print the rollback plan without executing SQL
  --execute      Explicitly request execution; execution remains the default for compatibility
  --allow-data-loss
  --allow-irreversible-data-loss
  --continue-on-error
  --remove       Also delete the migration, down and snapshot files
  --force        Skip the confirmation prompt only
  --yes          Alias for --force

repair:
  --mark-applied <idx>   Mark one migration applied without running its SQL
  --baseline             Mark every pending migration applied
  --clean-orphans        Delete tracking rows that are not in the journal
  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>
  --force                Skip the confirmation prompt

reset:
  --dialect <postgres|mysql|mariadb|sqlite|libsql|turso>
  --migrate              Run drizzle-kit migrate instead of drizzle-kit push
  --dry-run              Print reset SQL without dropping anything
  --force, --yes         Skip the confirmation prompt
  other options are passed through to drizzle-kit

DATABASE_URL must be set for status, rollback, repair and reset.
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
    case "reset":
      return reset(drizzleDir, rest);
    default:
      console.error(color("red", `Unknown command: ${command}\n`));
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(color("red", "Fatal error:"), err);
  process.exit(1);
});
