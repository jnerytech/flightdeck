/**
 * The template domain's public entry (#1589): the task templates of simple mode and their presets.
 * Another domain imports from here, never a file inside.
 */
export { BUILTIN_TEMPLATES } from "./domain/builtin.ts";
export { type LoadedTemplates, loadTemplates } from "./files.ts";
export { startTemplate } from "./start.ts";
export { TaskTracker } from "./tasks.ts";
