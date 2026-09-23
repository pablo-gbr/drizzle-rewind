# Examples

These are small Drizzle v0-style migration directories for local smoke tests.

```bash
npm run dev -- generate --dir examples/postgre
npm run dev -- generate --dir examples/mariadb --dialect mariadb
npm run dev -- generate --dir examples/sqlite --dialect sqlite --idx 1 --allow-table-rebuild
npm run dev -- rollback --dir examples/mariadb --dialect mariadb --dry-run
npm run dev -- rollback --dir examples/sqlite --dialect sqlite --dry-run
```

The MariaDB and SQLite fixtures exercise SQL generation and rollback planning.
DB-backed status, repair, and rollback need a live database plus `DATABASE_URL`.
