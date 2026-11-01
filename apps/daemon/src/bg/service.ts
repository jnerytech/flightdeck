import type { Database } from "bun:sqlite";
import type { BgList, BgSession } from "@flightdeck/protocol";
import { runCommand } from "../board/command.ts";

export interface BgServiceOptions {
  db: Database;
  /** The `claude` to ask; `null` when none is installed. */
  claude: () => string | null;
  /** Delivers a message through the channel of a session opened with `flightdeckd claude`; false when it has none. */
  channel?: (claudeSessionId: string, text: string) => boolean;
}

/** The listing and the commands are quick; a `claude` that does not answer is as good as none. */
const CLI_TIMEOUT_MS = 20_000;

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

/** Claude Code's background sessions (`claude --bg`), listed and controlled through its own CLI. */
export class BgService {
  constructor(private readonly opts: BgServiceOptions) {}

  private cost(claudeSessionId: string | null): number | null {
    if (!claudeSessionId) return null;
    const row = this.opts.db
      .query<{ cost: number | null }, [string]>(
        "SELECT SUM(cost_usd) AS cost FROM usage_entries WHERE claude_session_id = ?",
      )
      .get(claudeSessionId);
    return row?.cost ?? null;
  }

  /**
   * `claude agents --json --all`: every background session, finished ones too. The listing is
   * Claude Code's and may grow fields: what is not read is ignored, and an entry that is not a
   * background session with an id is skipped.
   */
  async list(): Promise<BgList> {
    const none: BgList = { supported: false, sessions: [] };
    const claude = this.opts.claude();
    if (!claude) return none;
    const result = await runCommand(
      [claude, "agents", "--json", "--all"],
      process.cwd(),
      undefined,
      CLI_TIMEOUT_MS,
    );
    if (result.code !== 0) return none;
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return none;
    }
    if (!Array.isArray(parsed)) return none;
    const sessions: BgSession[] = [];
    for (const entry of parsed) {
      const item = (entry ?? {}) as Record<string, unknown>;
      const id = text(item.id);
      if (item.kind !== "background" || !id) continue;
      const claudeSessionId = text(item.sessionId);
      sessions.push({
        id,
        name: text(item.name),
        cwd: text(item.cwd) ?? "",
        state: text(item.state) ?? "",
        status: text(item.status),
        waitingFor: text(item.waitingFor),
        pid: whole(item.pid),
        claudeSessionId,
        startedAt: whole(item.startedAt),
        costUsd: this.cost(claudeSessionId),
      });
    }
    return { supported: true, sessions };
  }

  async stop(_id: string): Promise<BgList> {
    return this.list();
  }

  async respawn(_id: string): Promise<BgList> {
    return this.list();
  }

  async message(_id: string, _text: string): Promise<BgList> {
    return this.list();
  }
}
