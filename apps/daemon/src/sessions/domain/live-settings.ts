import type {
  EffortLevel,
  McpLiveStatus,
  PermissionMode,
  SessionEvent,
} from "@flightdeck/protocol";
import type { AgentRun } from "../../runtime/index.ts";
import { refuseLooserMode, runtimeUnsupported, sessionNotLive } from "./refusals.ts";

/** What the live settings need from the manager: lookups and the one event they tell apps. */
export interface LiveSettingsDeps {
  /** The agent run of a session that has a process, if any. */
  runOf(sessionId: string): AgentRun | undefined;
  /** The runtime a stored session runs on; undefined for an unknown session. */
  runtimeOf(sessionId: string): string | undefined;
  /** The permission mode the session started with (which a persona may have narrowed). */
  startMode(sessionId: string): PermissionMode;
  bypassAllowed(): boolean;
  emit(sessionId: string, event: SessionEvent): void;
  /** Phase 13: the effort of a session started or left with one; not kept across restarts. */
  efforts: Map<string, EffortLevel>;
}

/** What a person changes in a live managed session without ending it: mode, model, effort, MCP. */
export class LiveSettings {
  constructor(private readonly deps: LiveSettingsDeps) {}

  /** Phase 39: refuses a Claude-only feature for an OpenCode session. */
  private claudeOnly(sessionId: string, feature: string): void {
    // An unknown session keeps its own refusal (the feature is not live).
    if (this.deps.runtimeOf(sessionId) !== "opencode") return;
    throw runtimeUnsupported(feature);
  }

  /** Phase 12: turns an MCP server of a live managed session on or off right away. */
  async toggleMcpServer(sessionId: string, name: string, enabled: boolean): Promise<void> {
    this.claudeOnly(sessionId, "mcp");
    const run = this.deps.runOf(sessionId);
    if (!run?.toggleMcpServer) {
      throw sessionNotLive("mcpSet");
    }
    await run.toggleMcpServer(name, enabled);
  }

  /** Changes the permission mode of a live managed session, for its next tool requests. */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const run = this.deps.runOf(sessionId);
    if (!run?.setPermissionMode) {
      throw sessionNotLive("mode");
    }
    refuseLooserMode(mode, () => this.deps.startMode(sessionId), this.deps.bypassAllowed());
    await run.setPermissionMode(mode);
    // Told to every app, and kept for a reload (#935); the start mode stays the session's limit.
    // A run that ended during the change reports nothing after its last status.
    if (this.deps.runOf(sessionId) !== run) return;
    this.deps.emit(sessionId, { type: "session.mode", permissionMode: mode });
  }

  /** Changes the model of a live managed session, for its next turn; null is the default. */
  async setModel(sessionId: string, model: string | null): Promise<void> {
    const run = this.deps.runOf(sessionId);
    if (!run?.setModel) {
      throw sessionNotLive("model");
    }
    await run.setModel(model ?? undefined);
  }

  /** Changes the effort of a live managed session, for its next turn; null is the model's default. */
  async setEffort(sessionId: string, effort: EffortLevel | null): Promise<void> {
    const run = this.deps.runOf(sessionId);
    if (!run?.setEffort) {
      throw sessionNotLive("effort");
    }
    await run.setEffort(effort ?? undefined);
    // A session resumed later starts with the effort it was left at (not kept across restarts).
    if (effort) this.deps.efforts.set(sessionId, effort);
    else this.deps.efforts.delete(sessionId);
  }

  /** Phase 12: the live status of a managed session's MCP servers, as its runtime reports it. */
  async mcpStatus(sessionId: string): Promise<McpLiveStatus[]> {
    this.claudeOnly(sessionId, "mcp");
    const run = this.deps.runOf(sessionId);
    if (!run?.mcpServerStatus) {
      throw sessionNotLive("mcpQuery");
    }
    return run.mcpServerStatus();
  }
}
