import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PluginDecision } from "../ports.ts";

/** A recorder that appends each decision as a line of JSON to `path`. */
export function pluginDecisionLog(path: string): (decision: PluginDecision) => Promise<void> {
  return async (decision) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(decision)}\n`);
  };
}
