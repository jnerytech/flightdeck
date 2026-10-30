/** Stub. */
import type { ActionDef } from "./schema.ts";

export interface Fingerprint {
  declaration: string;
  files: Record<string, string>;
}

/** Stub. */
export function fingerprint(_action: ActionDef, _base: string): Fingerprint {
  return { declaration: "", files: {} };
}

/** Stub. */
export function changes(_trusted: Fingerprint, _current: Fingerprint): string[] {
  return [];
}
