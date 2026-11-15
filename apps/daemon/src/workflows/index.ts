/**
 * The workflows domain's public entry (#1589). It exports the `{{ expression }}` references a
 * card's steps and the run env's configs share (#1594), the bounded check runner the watch domain
 * drives, the findings an agent step hands to the board as cards (#79), a source's hash and the
 * built-in templates; the board's imports move behind this entry with the board.ts split (#1523).
 * Another domain imports from here.
 */

export { type BoundedCheckRunner, shellCheckRunner } from "./check-runner.ts";
export { CARDS_PER_RUN, type CardsRaised, type Finding } from "./domain/findings.ts";
export { MAX_VALUE } from "./domain/interpolate.ts";
export { referencesIn, replaceReferences } from "./domain/references.ts";
export { workflowTemplates } from "./domain/templates.ts";
export { WorkflowEngine } from "./engine.ts";
export { hashOf } from "./repo.ts";
export { addWorkflowTemplate } from "./template-add.ts";
