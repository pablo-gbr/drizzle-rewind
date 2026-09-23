# SQLite Example

This fixture uses Drizzle v0-style SQLite snapshots.

```sh
npm run dev -- generate --dir examples/sqlite --dialect sqlite --idx 1 --allow-table-rebuild
npm run dev -- rollback --dir examples/sqlite --dialect sqlite --dry-run
```

Database-backed commands need `DATABASE_URL` and the optional `@libsql/client`
peer dependency.
