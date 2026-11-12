/**
 * The server domain's public entry for the other domains (#2094): the module each domain gives
 * `main.ts`. Another domain imports from here, never a file inside.
 */
export { createModuleRunner, type DomainModule, type ModuleRunner, serverGroup } from "./module.ts";
