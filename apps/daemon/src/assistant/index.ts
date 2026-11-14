/**
 * The assistant domain's public entry (#1589): the host's assistant, which answers questions about
 * a project with its context, and the folder it keeps. Other domains import only from here, with
 * two exceptions, each a cycle for dependency-cruiser through this entry: `factory.ts` stays out
 * (it reaches the board; `main.ts`, outside any domain, takes `assistantService` from it), and
 * `permissions/auto-approve.ts` takes `assistantDir` from `paths.ts` (`service.ts` reaches
 * `permissions/` back through `costs/`).
 */
export { assistantDir } from "./paths.ts";
export type { AssistantService } from "./service.ts";
