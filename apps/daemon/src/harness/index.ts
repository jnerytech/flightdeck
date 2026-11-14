/**
 * The harness domain's public entry (#1589): the parts a harness preview names and a project's
 * Markdown harness shared as a host template. Other domains import only from here. `main.ts` builds
 * the domain from `wiring.ts`, which stays out of this entry: its import of `server/index.ts` would
 * make a cycle.
 */
export type { PreviewPart } from "./preview.ts";
export type { HarnessTemplates, TemplateMarkdown } from "./templates-store.ts";
