# Changelog

## 0.1.0 - Initial Release

Initial `drizzle-rewind` release, forked from
[AnasIsmai1/drizzle-down](https://github.com/AnasIsmai1/drizzle-down).

This release keeps the original project's PostgreSQL behavior and focuses on
turning the codebase into a multi-dialect rollback tool.

### Added

- SQL dialect abstraction for renderer-specific behavior.
- Database adapter abstraction for driver-specific query, transaction, and
  migration tracking behavior.
- MariaDB/MySQL SQL generation with backtick identifier quoting.
- MariaDB/MySQL database adapter using `mysql2/promise`.
- MariaDB/MySQL rollback execution with non-transactional DDL warnings.
- Rollback execution plans, `--dry-run`, and explicit `--execute`.
- Safety classification for data-loss, irreversible data-loss, and unsupported
  operations.
- Safety guards for destructive rollback execution.
- JSON output for generated rollback plans.
- Dialect-aware CLI options for `generate`, `status`, `rollback`, and `repair`.
- Example Drizzle migration folders for PostgreSQL and MariaDB/MySQL.
- Local `.env` usage guidance via Node's `--env-file` flag.
- Apache-2.0 licensing for the rebranded project.

### Notes

- MariaDB/MySQL DDL is not fully transactional. A failed rollback may leave
  earlier statements already applied.
- `--yes` and `--force` skip confirmation prompts only. They do not acknowledge
  destructive operations.
- Drizzle v0-style `meta/_journal.json` and `meta/*_snapshot.json` migrations
  are supported. Drizzle 1.x folder-style migrations are not supported yet.

See [ROADMAP.md](ROADMAP.md) for planned work.
