# Roadmap

## Done

- [x] Fork and rebrand from `drizzle-down` to `drizzle-rewind`.
- [x] Preserve the original PostgreSQL behavior.
- [x] Add SQL dialect abstraction.
- [x] Add database adapter abstraction.
- [x] Add MariaDB/MySQL SQL generation.
- [x] Add MariaDB/MySQL database adapter.
- [x] Add MariaDB/MySQL rollback execution with non-transactional DDL warnings.
- [x] Add rollback plans and `--dry-run`.
- [x] Add safety classification and rollback guard flags.
- [x] Add JSON generation output.
- [x] Add example PostgreSQL and MariaDB/MySQL migration folders.
- [x] Switch the project license to Apache-2.0.

## Planned

- [ ] SQLite SQL generation and rollback support.
- [ ] Drizzle 1.x migration folder support.
- [ ] More complete MariaDB/MySQL integration tests across versions.
- [ ] PostgreSQL integration regression tests in CI.
- [ ] Golden-file SQL tests for common rollback scenarios.
- [ ] More precise safety classification from structured diff operations.
- [ ] Better dialect/config detection from Drizzle config files.
- [ ] Optional `.env` loading ergonomics for local CLI usage.
- [ ] CI templates for GitHub Actions, GitLab CI, and other deploy pipelines.
- [ ] Richer repair/status diagnostics for ambiguous migration tracking states.
- [ ] Redacted database URL diagnostics for verbose mode.
- [ ] More snapshot fixture coverage for FKs, indexes, type changes, and generated columns.
