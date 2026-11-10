/**
 * The central's public entry (#1589): terminal sessions seen through Claude Code's hooks. Another
 * domain imports from here, never a file inside.
 */
export {
  type HooksStatus,
  hooksStatus,
  hookTarget,
  installHooks,
  uninstallHooks,
} from "./hooks-install.ts";
