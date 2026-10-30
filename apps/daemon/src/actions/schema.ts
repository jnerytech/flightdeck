/** Stub. */
export type ApprovalMode = "always" | "never" | "first-per-session";

export interface ActionParam {
  pattern: string;
  default?: string;
}

export interface ActionDef {
  name: string;
  description: string;
  host?: string;
  ssh?: string;
  run: string[];
  cwd?: string;
  env: Record<string, string>;
  params: Record<string, ActionParam>;
  timeoutS: number;
  approval?: ApprovalMode;
}

export interface ParseOptions {
  /** The secrets the app has; a reference to another one is an error. */
  secretIds?: ReadonlySet<string>;
}

/** Stub. */
export function parseActions(
  _yaml: string,
  _opts: ParseOptions = {},
): { actions: ActionDef[]; errors: string[] } {
  return { actions: [{} as ActionDef], errors: [] };
}

/** Stub. */
export function validateAction(
  _raw: unknown,
  _opts: ParseOptions = {},
): { action: ActionDef | null; errors: string[] } {
  return { action: null, errors: [] };
}

/** Stub. */
export function approvalOf(_action: ActionDef): ApprovalMode {
  return "never";
}

/** Stub. */
export function secretsOf(_action: ActionDef): { values: string[]; files: string[] } {
  return { values: [], files: [] };
}
