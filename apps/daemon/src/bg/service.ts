import type { Database } from "bun:sqlite";
import type { BgList, BgSession } from "@flightdeck/protocol";
import { runCommand } from "../board/command.ts";
import { FlightdeckError } from "../errors.ts";

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

  /** The session the listing has under `id`, or the refusal the app says in its language. */
  private async find(id: string): Promise<BgSession> {
    const found = (await this.list()).sessions.find((session) => session.id === id);
    if (!found) {
      throw new FlightdeckError(
        "not_found",
        `background session ${id} is not listed`,
        "bg_not_found",
        { id },
      );
    }
    return found;
  }

  /** Runs a `claude` command; a refusal of Claude Code reaches the app with what it said. */
  private async claudeDo(args: string[]): Promise<void> {
    // The listing was just read, so a `claude` exists.
    const claude = this.opts.claude() ?? "claude";
    const result = await runCommand([claude, ...args], process.cwd(), undefined, CLI_TIMEOUT_MS);
    if (result.code !== 0) {
      const message = (result.stderr || result.stdout).trim().slice(0, 300);
      throw new FlightdeckError("invalid_state", `claude ${args[0]}: ${message}`, "bg_cli_failed", {
        message,
      });
    }
  }

  async stop(id: string): Promise<BgList> {
    await this.find(id);
    await this.claudeDo(["stop", id]);
    return this.list();
  }

  /** Restarts the session so it runs the current Claude Code (it resumes its saved conversation). */
  async respawn(id: string): Promise<BgList> {
    await this.find(id);
    await this.claudeDo(["respawn", id]);
    return this.list();
  }

  /**
   * Claude Code has no command to type into a running background session. A message goes through
   * the channel of a session opened with `flightdeckd claude`; a session with no process is
   * continued with the message as its prompt (`--resume <id> --bg`); a running one without a
   * channel cannot be told anything.
   */
  async message(id: string, text: string): Promise<BgList> {
    const session = await this.find(id);
    const claudeSessionId = session.claudeSessionId;
    if (claudeSessionId && this.opts.channel?.(claudeSessionId, text)) return this.list();
    if (session.pid !== null || !claudeSessionId) {
      throw new FlightdeckError(
        "invalid_state",
        "a running background session has no way to receive a message",
        "bg_no_message_path",
      );
    }
    await this.claudeDo(["--resume", claudeSessionId, "--bg", "--", text]);
    return this.list();
  }
}
