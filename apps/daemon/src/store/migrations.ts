import { ISSUES } from "./migrations/issues.ts";
import { PHASES_1_TO_8 } from "./migrations/phases-01-08.ts";
import { PHASES_11_TO_20 } from "./migrations/phases-11-20.ts";
import { PHASES_21_TO_40 } from "./migrations/phases-21-40.ts";

/**
 * Versioned schema migrations, applied in order on boot (tracked by `PRAGMA user_version`).
 * Split by group (#1595): a new migration goes at the end of the last group, never between two.
 */
export const MIGRATIONS: readonly string[] = [
  ...PHASES_1_TO_8,
  ...PHASES_11_TO_20,
  ...PHASES_21_TO_40,
  ...ISSUES,
];
