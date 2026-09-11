import type { RollbackWarning } from "./types";

export function warningComments(warnings: RollbackWarning[]): string {
  const risky = warnings.filter((w) => w.level !== "safe");
  if (risky.length === 0) return "";
  return risky
    .map((w) => `-- WARNING: ${w.level.toUpperCase()}: ${commentMessage(w)}`)
    .join("\n") + "\n\n";
}

export function classifySqlWarnings(sql: string): RollbackWarning[] {
  const warnings: RollbackWarning[] = [];
  const upper = sql.toUpperCase();

  if (upper.includes("WARNING: UNSUPPORTED")) {
    warnings.push({
      level: "unsupported",
      operation: "sql-warning",
      message: "A generated SQL warning marked this rollback as unsupported.",
    });
  }
  if (upper.includes("WARNING: IRREVERSIBLE-DATA-LOSS")) {
    warnings.push({
      level: "irreversible-data-loss",
      operation: "sql-warning",
      message: "A generated SQL warning marked this rollback as irreversible data loss.",
    });
  }
  if (upper.includes("WARNING: DATA-LOSS") || /\bDROP\s+(TABLE|COLUMN)\b/.test(upper)) {
    warnings.push({
      level: "data-loss",
      operation: "sql-scan",
      message: "Rollback SQL contains potentially destructive operations.",
    });
  }

  return warnings;
}

function commentMessage(warning: RollbackWarning): string {
  return warning.message.replace(/^(DATA LOSS|IRREVERSIBLE DATA LOSS|UNSUPPORTED):\s*/, "");
}
