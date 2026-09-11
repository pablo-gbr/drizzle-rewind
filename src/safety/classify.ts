import type {
  RollbackOperation,
  RollbackRiskLevel,
  RollbackRiskSummary,
  RollbackWarning,
} from "./types";

const SAFE = new Set([
  "drop-index",
  "drop-foreign-key",
  "drop-unique-constraint",
  "drop-primary-key",
  "add-index",
  "add-foreign-key",
  "add-unique-constraint",
  "add-primary-key",
  "drop-enum",
  "restore-enum",
  "set-default",
  "drop-default",
  "drop-not-null",
]);

export function classifyRollbackOperation(
  op: RollbackOperation,
): RollbackWarning {
  const level = riskLevel(op.operation);
  return {
    level,
    operation: op.operation,
    table: op.table,
    column: op.column,
    message: messageFor(level, op),
  };
}

export function summarizeWarnings(
  warnings: RollbackWarning[],
): RollbackRiskSummary {
  return warnings.reduce<RollbackRiskSummary>(
    (summary, warning) => {
      summary[warning.level]++;
      return summary;
    },
    { safe: 0, "data-loss": 0, "irreversible-data-loss": 0, unsupported: 0 },
  );
}

export function printableWarnings(
  warnings: RollbackWarning[],
): RollbackWarning[] {
  return warnings.filter((w) => w.level !== "safe");
}

export function assertRollbackAllowed(
  warnings: RollbackWarning[],
  opts: {
    allowDataLoss?: boolean;
    allowIrreversibleDataLoss?: boolean;
  },
): void {
  const summary = summarizeWarnings(warnings);
  if (summary.unsupported > 0) {
    throw new Error("Rollback blocked: unsupported operations were detected.");
  }
  if (
    summary["irreversible-data-loss"] > 0 &&
    !opts.allowIrreversibleDataLoss
  ) {
    throw new Error(
      "Rollback blocked: irreversible data loss was detected. Re-run with --allow-irreversible-data-loss only if an appropriate backup/recovery path exists.",
    );
  }
  if (
    summary["data-loss"] > 0 &&
    !opts.allowDataLoss &&
    !opts.allowIrreversibleDataLoss
  ) {
    throw new Error(
      "Rollback blocked: potentially destructive operations were detected. Re-run with --allow-data-loss after reviewing the generated SQL.",
    );
  }
}

function riskLevel(operation: string): RollbackRiskLevel {
  if (SAFE.has(operation)) return "safe";
  if (operation === "restore-column" || operation === "restore-table") {
    return "irreversible-data-loss";
  }
  if (
    operation === "drop-column" ||
    operation === "drop-table" ||
    operation === "modify-column" ||
    operation === "set-not-null"
  ) {
    return "data-loss";
  }
  return "unsupported";
}

function messageFor(
  level: RollbackRiskLevel,
  op: RollbackOperation,
): string {
  const target = [op.table, op.column].filter(Boolean).join(".");
  if (level === "safe") return `Safe rollback operation: ${op.operation}.`;
  if (level === "data-loss") {
    return `DATA LOSS: ${target || op.operation} may remove or reject values written after the migration.`;
  }
  if (level === "irreversible-data-loss") {
    return `IRREVERSIBLE DATA LOSS: ${target || op.operation} can be recreated structurally, but previous data cannot be recovered from schema snapshots.`;
  }
  if (op.operation === "enum-added-values") {
    return `UNSUPPORTED: enum "${op.table}" gained values (${op.column}). PostgreSQL cannot remove enum values safely.`;
  }
  return `UNSUPPORTED: ${op.operation} cannot be represented safely.`;
}
