import { join } from "node:path";

/** Phase 40: the assistant's scratch folder: its one-shot calls run there; nothing is kept. */
export function assistantDir(dataDir: string): string {
  return join(dataDir, "assistant");
}
