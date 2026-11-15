/**
 * The assistant domain's public entry (#1589): the host's assistant, which answers questions about
 * a project with its context. Other domains import only from here, with one exception, a cycle
 * for dependency-cruiser through this entry: `factory.ts` stays out (it reaches the board;
 * `main.ts`, outside any domain, takes `assistantService` from it). The folder it keeps,
 * `assistantDir`, is in the kernel: the history's exclusions in `permissions/` name it too.
 */
export type { AssistantService } from "./service.ts";
