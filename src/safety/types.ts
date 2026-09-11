export type RollbackRiskLevel =
  | "safe"
  | "data-loss"
  | "irreversible-data-loss"
  | "unsupported";

export interface RollbackWarning {
  level: RollbackRiskLevel;
  operation: string;
  table?: string;
  column?: string;
  message: string;
}

export interface RollbackRiskSummary {
  safe: number;
  "data-loss": number;
  "irreversible-data-loss": number;
  unsupported: number;
}

export interface RollbackOperation {
  operation: string;
  table?: string;
  column?: string;
}
