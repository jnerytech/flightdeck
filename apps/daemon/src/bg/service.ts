import type { Database } from "bun:sqlite";
import type { BgList } from "@flightdeck/protocol";

export interface BgServiceOptions {
  db: Database;
  /** The `claude` to ask; `null` when none is installed. */
  claude: () => string | null;
}

/** Claude Code's background sessions (`claude --bg`), listed and controlled through its own CLI. */
export class BgService {
  constructor(private readonly opts: BgServiceOptions) {}

  async list(): Promise<BgList> {
    return { supported: false, sessions: [] };
  }
}
