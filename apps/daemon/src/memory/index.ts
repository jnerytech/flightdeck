/**
 * The memory domain's public entry (#1589): a project's auto memory, whose writes are recorded by
 * name and hash only. Another domain imports from here, never a file inside.
 */
export { exists } from "./exists.ts";
export { decisionLog, ProjectMemory } from "./memory.ts";
