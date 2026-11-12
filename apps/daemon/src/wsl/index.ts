/**
 * WSL's public entry (#1589, #1594): a host that runs inside WSL, and the distros whose daemons
 * a Windows host keeps running. Another domain imports from here, never a file inside.
 */
export {
  defaultHostName,
  detectWsl,
  readProcVersion,
  realWslProbe,
  WSL_PORT_OFFSET,
  type WslProbe,
} from "./host.ts";
export { createWsl, type WslItem } from "./supervisor.ts";
