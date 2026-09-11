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

## Status

- PostgreSQL: supported for generation, status, rollback, and repair
- MariaDB/MySQL: supported for generation, status, and repair
- SQLite: not supported yet

Rollback execution is currently PostgreSQL-only. MariaDB/MySQL DDL is not fully
transactional, so execution waits for stricter safety guards.

## Commands

```sh
drizzle-rewind generate    # write <tag>.down.sql for migrations missing one
drizzle-rewind status      # applied, pending and orphan migrations
drizzle-rewind rollback    # run down migrations against PostgreSQL
drizzle-rewind repair      # fix the tracking table without running migration SQL
```

`status`, `rollback`, and `repair` need `DATABASE_URL`. `generate` only reads
files.

The migration directory is found from `out` in your `drizzle.config.ts`, or
`DRIZZLE_DIR`, or `--dir <path>`, in that order.

## Generate

Diffs each migration snapshot against the one before it and writes the SQL that
undoes it next to the migration as `<tag>.down.sql`.

```sh
drizzle-rewind generate
drizzle-rewind generate --idx 42
drizzle-rewind generate --dialect postgres
drizzle-rewind generate --dialect mariadb --idx 1
```

Existing down files are never overwritten without `--idx`.

MariaDB/MySQL generation currently covers common table, column, index, foreign
key, primary key, unique constraint, and default rollback SQL. Column changes
use `MODIFY COLUMN` with the full previous column definition so nullability,
defaults, and auto-increment metadata are preserved when present in snapshots.

Some changes cannot be undone from schema snapshots alone. Restoring a dropped
column or table recreates the structure, but the previous data is gone.

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
drizzle-rewind rollback --remove       # also delete migration and snapshot files
drizzle-rewind rollback --force        # skip the confirmation prompt
```

PostgreSQL rollback keeps the original behavior: each migration is undone inside
its own transaction.

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
```

Optional drivers:

```sh
npm install pg
npm install mysql2
```

## License

Apache-2.0
