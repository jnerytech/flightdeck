/** Stub. */
export type RiskLevel = "low" | "medium" | "high";

export interface Risk {
  level: RiskLevel;
  reason: string;
  network: boolean;
}

export interface RiskOptions {
  allowedRoots: readonly string[];
  home?: string;
  extraHigh?: readonly string[];
}

/** Stub. */
export class RiskClassifier {
  constructor(readonly opts: RiskOptions) {}

  classify(_toolName: string, _input: Record<string, unknown>, _cwd: string): Risk {
    return { level: "low", reason: "", network: false };
  }
}

/** Stub. */
export function validRegex(_source: string): boolean {
  return true;
}
