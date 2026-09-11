# drizzle-rewind

Down migration generation, rollback helpers, status, and repair tooling for
[Drizzle ORM](https://orm.drizzle.team).

This project is a fork and continuation of
[AnasIsmai1/drizzle-down](https://github.com/AnasIsmai1/drizzle-down), which
started as a PostgreSQL rollback helper using drizzle-kit's own snapshot files.
`drizzle-rewind` keeps that PostgreSQL behavior and is being extended with
first-class MariaDB/MySQL support.

```sh
npm i -D drizzle-rewind
```

## Supported Engines

- 🟢 PostgreSQL: supported for generation, status, rollback, and repair
- 🔵 MariaDB/MySQL: supported for generation, status, rollback, and repair
- ⚪ SQLite: not supported yet

MariaDB/MySQL DDL is not fully transactional. Rollback execution prints that
warning and stops on the first failed statement by default.

This is not a disaster-recovery tool. Generate and review rollback SQL before
execution, and keep real database backups or point-in-time recovery available
for production systems.

## Commands

```sh
drizzle-rewind generate    # write <tag>.down.sql for migrations missing one
drizzle-rewind status      # applied, pending and orphan migrations
drizzle-rewind rollback    # preview and run down migrations with safety guards
drizzle-rewind repair      # fix the tracking table without running migration SQL
```

Get CLI help with:

```sh
drizzle-rewind --help
drizzle-rewind -h
```

`status`, `rollback`, and `repair` need `DATABASE_URL`. `generate` only reads
files.

The migration directory is found from `out` in your `drizzle.config.ts`, or
`DRIZZLE_DIR`, or `--dir <path>`, in that order.

Use `--dialect postgres`, `--dialect mysql`, or `--dialect mariadb` when the
database type cannot be inferred from context. `mysql` and `mariadb` use the
same SQL dialect implementation.

## Local Usage

When running from an installed local package, npm scripts are usually the
simplest path:

```jsonc
{
  "scripts": {
    "db:down": "drizzle-rewind generate --dialect mariadb",
    "db:status": "drizzle-rewind status --dialect mariadb",
    "db:rollback:preview": "drizzle-rewind rollback --dialect mariadb --steps 1 --dry-run",
    "db:rollback": "node --env-file=.env ./node_modules/drizzle-rewind/dist/src/cli.js rollback --dialect mariadb --steps 1 --execute --allow-data-loss --yes"
  }
}
```

Node does not automatically load `.env` files for CLI binaries. If your local
workflow depends on `.env`, either set `DATABASE_URL` in the shell before
running `drizzle-rewind`, or use Node's built-in `--env-file=.env` flag as shown
above.

PowerShell example:

```powershell
$env:DATABASE_URL="mysql://root:root@127.0.0.1:3307/rewind_test"
npx drizzle-rewind status --dialect mariadb
```

bash/zsh example:

```sh
export DATABASE_URL="mysql://root:root@127.0.0.1:3307/rewind_test"
npx drizzle-rewind status --dialect mariadb
```

## Generate

Diffs each migration snapshot against the one before it and writes the SQL that
undoes it next to the migration as `<tag>.down.sql`.

```sh
drizzle-rewind generate
drizzle-rewind generate --idx 42
drizzle-rewind generate --dialect postgres
drizzle-rewind generate --dialect mariadb --idx 1
drizzle-rewind generate --dialect mariadb --idx 1 --format json
drizzle-rewind generate --idx 1 --output rollback.sql
drizzle-rewind generate --fail-on-warning
drizzle-rewind generate --fail-on-data-loss
```

Existing down files are never overwritten without `--idx`.

MariaDB/MySQL generation currently covers common table, column, index, foreign
key, primary key, unique constraint, and default rollback SQL. Column changes
use `MODIFY COLUMN` with the full previous column definition so nullability,
defaults, and auto-increment metadata are preserved when present in snapshots.

Some changes cannot be undone from schema snapshots alone. Restoring a dropped
column or table recreates the structure, but the previous data is gone.
Generated SQL files include warning comments for destructive or unsupported
rollback operations.

`--format json` prints machine-readable statements and warnings instead of
writing `.down.sql` files.

## Status And Repair

```sh
drizzle-rewind status
drizzle-rewind status --strict
drizzle-rewind status --dialect mariadb

drizzle-rewind repair --mark-applied 7
drizzle-rewind repair --baseline
drizzle-rewind repair --clean-orphans
drizzle-rewind repair --dialect mariadb --baseline
```

An orphan is a row in the Drizzle migration tracking table with no matching
journal entry. On a shared database that can be legitimate, so orphans stay
informational even under `--strict`.

PostgreSQL uses `pg`. MariaDB/MySQL uses `mysql2`.

## Rollback

```sh
drizzle-rewind rollback                # undo the most recent PostgreSQL migration
drizzle-rewind rollback --steps 3      # undo the last three
drizzle-rewind rollback --to 41        # undo everything above journal index 41
drizzle-rewind rollback --dialect postgres
drizzle-rewind rollback --dialect mariadb --dry-run
drizzle-rewind rollback --dialect mariadb --execute
drizzle-rewind rollback --allow-data-loss
drizzle-rewind rollback --allow-irreversible-data-loss
drizzle-rewind rollback --continue-on-error
drizzle-rewind rollback --remove       # also delete migration and snapshot files
drizzle-rewind rollback --force        # skip the confirmation prompt only
drizzle-rewind rollback --yes          # alias for --force
```

Rollback prints an execution plan before it mutates the database. `--dry-run`
prints that plan and stops. Execution remains the default for compatibility;
`--execute` is accepted when you want the command to be explicit.

PostgreSQL runs each migration inside its own transaction. MariaDB/MySQL runs
statements sequentially, updates migration tracking only after a migration has
fully completed, and reports which statements succeeded if a later statement
fails. `--continue-on-error` keeps going after a failed MariaDB/MySQL statement
and is meant for advanced recovery work only.

Rollback execution is blocked when destructive SQL is detected unless the
matching acknowledgement flag is present. `--force` and `--yes` only skip
confirmation prompts; they do not acknowledge data loss.

MariaDB/MySQL warning:

```text
Warning: MariaDB/MySQL DDL is not fully transactional.
If a rollback statement fails, earlier DDL may already have been applied.
Review the generated SQL and ensure backups/recovery procedures exist.
```

## CI Example

```yaml
rollback_preview:
  script:
    - drizzle-rewind generate --dialect mariadb --idx 1 --format json
    - drizzle-rewind rollback --dialect mariadb --steps 1 --dry-run

rollback_execute:
  when: manual
  script:
    - drizzle-rewind rollback --dialect mariadb --steps 1 --execute --allow-data-loss --yes
```

`--yes` does not acknowledge destructive rollback operations. Use
`--allow-data-loss` or `--allow-irreversible-data-loss` after reviewing the
generated SQL.

## Exit Codes

- `0`: success
- `1`: generic error
- `2`: invalid CLI usage or configuration
- `3`: unsupported migration or dialect operation
- `4`: destructive rollback blocked by safety guards
- `5`: database execution failed
- `6`: migration state mismatch or tracking inconsistency

## Recovery Limits

`drizzle-rewind` is not a substitute for:

- backups
- database snapshots
- point-in-time recovery
- tested deployment rollback procedures
- expand/contract schema migration practices when required

## Programmatic Use

```ts
import {
  diffSnapshots,
  generate,
  mysqlDialect,
  postgresDialect,
  repair,
  rollback,
  status,
} from "drizzle-rewind";

const pgDown = diffSnapshots(
  currentSnapshot,
  previousSnapshot,
  postgresDialect,
);
const mysqlDown = diffSnapshots(
  currentSnapshot,
  previousSnapshot,
  mysqlDialect,
);

await rollback("./drizzle", ["--steps", "2", "--force"]);
```

## Compatibility

`drizzle-rewind` expects the Drizzle v0-style migration layout:

- `meta/_journal.json`
- `meta/*_snapshot.json`
- snapshot version 7

Version support is targeted at drizzle-kit `0.31.x` and drizzle-orm `0.44.x`.
Drizzle 1.x migration folders are not supported yet.

## Development

```sh
npm run build
npm test
npm run dev -- generate --dir examples/postgre --idx 1
npm run dev -- generate --dir examples/mariadb --dialect mariadb --idx 1
npm run dev -- rollback --dir examples/mariadb --dialect mariadb --dry-run
```

Optional drivers:

```sh
npm install pg
npm install mysql2
```

See [CHANGELOG.md](CHANGELOG.md) for release notes and [ROADMAP.md](ROADMAP.md)
for planned work.

## License

Apache-2.0
