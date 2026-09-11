import * as fs from "fs";
import * as path from "path";

import { BREAKPOINT, type JournalEntry } from "../journal";
import { summarizeWarnings } from "../safety/classify";
import { classifySqlWarnings } from "../safety/sql";
import type { RollbackRiskSummary, RollbackWarning } from "../safety/types";

export interface RollbackPlanMigration {
  entry: JournalEntry;
  downPath: string;
  statements: string[];
  warnings: RollbackWarning[];
}

export interface RollbackPlan {
  dialect: string;
  from: string;
  to: string;
  migrations: RollbackPlanMigration[];
  statements: string[];
  warnings: RollbackWarning[];
  summary: RollbackRiskSummary;
}

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim().replace(/;$/, "").trim())
    .filter((s) => s.length > 0);
}

export function buildRollbackPlan(
  drizzleDir: string,
  dialect: string,
  targets: JournalEntry[],
  toTag: string,
): RollbackPlan {
  const migrations = targets.map((entry) => {
    const downPath = path.join(drizzleDir, `${entry.tag}.down.sql`);
    const sql = fs.readFileSync(downPath, "utf-8");
    return {
      entry,
      downPath,
      statements: splitSqlStatements(sql),
      warnings: classifySqlWarnings(sql),
    };
  });
  const statements = migrations.flatMap((m) => m.statements);
  const warnings = migrations.flatMap((m) => m.warnings);
  const summary = summarizeWarnings(warnings);
  summary.safe = Math.max(
    0,
    statements.length -
      summary["data-loss"] -
      summary["irreversible-data-loss"] -
      summary.unsupported,
  );

  return {
    dialect,
    from: targets[0]?.tag ?? "",
    to: toTag,
    migrations,
    statements,
    warnings,
    summary,
  };
}

export function printRollbackPlan(plan: RollbackPlan): void {
  console.log(`Dialect: ${plan.dialect}`);
  console.log(`Rollback: ${plan.from} -> ${plan.to}`);
  console.log(`Migrations: ${plan.migrations.length}`);
  console.log(`Statements: ${plan.statements.length}`);
  console.log("");
  console.log("Risk summary:");
  console.log(`  SAFE: ${plan.summary.safe}`);
  console.log(`  DATA LOSS: ${plan.summary["data-loss"]}`);
  console.log(`  IRREVERSIBLE DATA LOSS: ${plan.summary["irreversible-data-loss"]}`);
  console.log(`  UNSUPPORTED: ${plan.summary.unsupported}`);
  console.log("");
  console.log("Statements:");
  plan.statements.forEach((stmt, i) => {
    console.log(`  ${i + 1}. ${oneLine(stmt)}`);
  });
}

export function printMariaDbDDLWarning(statementCount: number): void {
  console.log("");
  console.log("Warning: MariaDB/MySQL DDL is not fully transactional.");
  if (statementCount >= 3) {
    console.log(
      `If rollback statement 3 of ${statementCount} fails, statements 1-2 may already have been applied.`,
    );
  } else {
    console.log("If a rollback statement fails, earlier DDL may already have been applied.");
  }
  console.log(
    "Review the generated SQL and ensure backups/recovery procedures exist.",
  );
}

function oneLine(sql: string): string {
  return sql.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
}
