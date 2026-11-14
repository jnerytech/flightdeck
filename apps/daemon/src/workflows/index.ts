/**
 * The workflows domain's public entry (#1589). It exports the `{{ expression }}` references a
 * card's steps and the run env's configs share (#1594), the bounded check runner the watch domain
 * drives, a source's hash and the built-in templates; the board's imports move behind this entry
 * with the board.ts split (#1523). Another domain imports from here.
 */

export type { BoundedCheckRunner } from "./check-runner.ts";
export { MAX_VALUE } from "./interpolate.ts";
export { referencesIn, replaceReferences } from "./references.ts";
export { hashOf } from "./repo.ts";
export { workflowTemplates } from "./templates.ts";
