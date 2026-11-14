/**
 * The central's public entry (#1589): terminal sessions seen through Claude Code's hooks. Another
 * domain imports from here, never a file inside.
 */

export { type Central, messageExternal } from "./central.ts";
export { startChannel } from "./channel.ts";
export type { HooksStatus, HookTarget } from "./domain/hook-entries.ts";
export type { ExternalSessions } from "./external.ts";
export { sendSessionStart } from "./hook-command.ts";
export {
  hooksStatus,
  hookTarget,
  installHooks,
  uninstallHooks,
} from "./hooks-install.ts";
export { type AsyncGitRunner, type ProjectKeys, runGitAsync, stripRemote } from "./project-key.ts";
export { runClaude, TELEMETRY_FILE, TERMINAL_LAUNCH_VAR } from "./wrapper.ts";
