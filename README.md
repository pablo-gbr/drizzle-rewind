# drizzle-down

Down migrations, rollback, status and repair for [Drizzle ORM](https://orm.drizzle.team) on PostgreSQL.

drizzle-kit generates forward migrations and applies them. It does not generate
down migrations, it cannot roll back, and it has no way to tell you what is
actually applied. This fills those four gaps using drizzle-kit's own snapshot
files, so there is nothing new to keep in sync.

```sh
npm i -D drizzle-down
```

## Commands

```sh
drizzle-down generate    # write <tag>.down.sql for every migration missing one
drizzle-down status      # applied, pending and orphan migrations
drizzle-down rollback    # run down migrations against the database
drizzle-down repair      # fix the tracking table without running migration SQL
```

`status`, `rollback` and `repair` need `DATABASE_URL`. `generate` only reads files.

The migration directory is found from `out` in your `drizzle.config.ts`, or
`DRIZZLE_DIR`, or `--dir <path>`, in that order.

## Adding it to a project

Nothing to copy in. Install it and add the scripts:

```jsonc
// package.json
{
  "scripts": {
    "db:generate-down": "drizzle-down generate",
    "db:status": "drizzle-down status",
    "db:rollback": "drizzle-down rollback",
    "db:repair": "drizzle-down repair"
  }
}
```

It reads `out` from your existing `drizzle.config.ts`, so there is no second
config to keep in sync. If your migrations live somewhere else, pass `--dir` or
set `DRIZZLE_DIR`.

In CI, `drizzle-down status --strict` fails the build while a migration is
still pending.

## generate

Diffs each migration's snapshot against the one before it and writes the SQL
that undoes it, next to the migration as `<tag>.down.sql`.

```sh
drizzle-down generate           # every migration that has no down file yet
drizzle-down generate --idx 42  # just this one, overwriting an existing file
```

Existing down files are never overwritten without `--idx`, so hand-edits
survive.

Some changes cannot be undone, and generate says so rather than pretending:

- Restoring a dropped column or table recreates the structure. The data is gone.
- PostgreSQL cannot remove a value from an enum. Adding one is a one-way door,
  and the generated down file leaves it alone instead of emitting SQL that
  would fail.

Operations are ordered so the SQL actually runs: indexes and constraints come
off before the columns they reference, and go back on after the tables they
belong to exist again.

## status

```sh
drizzle-down status
drizzle-down status --strict   # exit 1 while anything is pending
```

```
Migration status:

  [applied]  [0000] 0000_init
  [applied]  [0001] 0001_add_teams
  [pending]  [0002] 0002_add_invites (no down.sql)

Applied: 2 | Pending: 1 | Orphans: 0
```

An orphan is a row in `drizzle.__drizzle_migrations` with no matching journal
entry, usually a migration from a branch that never merged. On a shared
database that is often legitimate, so orphans stay informational even under
`--strict`.

Use `--strict` in CI or a deploy pipeline so a build fails instead of shipping
code whose migrations were skipped.

## rollback

```sh
drizzle-down rollback                # undo the most recent migration
drizzle-down rollback --steps 3      # undo the last three
drizzle-down rollback --to 41        # undo everything above journal index 41
drizzle-down rollback --remove       # also delete the migration and snapshot files
drizzle-down rollback --force        # skip the confirmation prompt
```

Each migration is undone inside its own transaction. If a statement fails the
transaction rolls back and the command stops, so the database is never left
half-undone. Migrations containing `DROP TABLE` or `DROP COLUMN` are marked as
destructive in the confirmation list before you agree to anything.

`--remove` deletes the `.sql`, `.down.sql` and snapshot files and rewrites the
journal, for when you want the migration gone rather than just reverted.

## repair

For when the tracking table and the journal disagree.

```sh
drizzle-down repair --mark-applied 7   # record it as applied without running its SQL
drizzle-down repair --baseline         # record every pending migration as applied
drizzle-down repair --clean-orphans    # delete tracking rows with no journal entry
```

`--baseline` is the one you want when adopting Drizzle on a database whose
schema already exists.

## Programmatic use

Every command is callable from code, for wiring rollback into your own tooling:

```ts
import { generate, status, rollback, repair, diffSnapshots } from "drizzle-down";

await rollback("./drizzle", ["--steps", "2", "--force"]);

// or work with the differ directly
const { statements, warnings } = diffSnapshots(currentSnapshot, previousSnapshot);
```

## Requirements

Node 20 or newer, PostgreSQL, and `pg` as a peer dependency. Only the
`postgresql` dialect is supported.

## License

MIT
