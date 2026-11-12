/**
 * The central's public entry (#1589): terminal sessions seen through Claude Code's hooks. Another
 * domain imports from here, never a file inside.
 */

export type { Central } from "./central.ts";
export { startChannel } from "./channel.ts";
export { sendSessionStart } from "./hook-command.ts";
export {
  type HooksStatus,
  type HookTarget,
  hooksStatus,
  hookTarget,
  installHooks,
  uninstallHooks,
} from "./hooks-install.ts";
export type { ProjectKeys } from "./project-key.ts";
export { runClaude } from "./wrapper.ts";
