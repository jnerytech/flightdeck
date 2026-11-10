import type { BgList, BgSession, CommandPayload } from "@flightdeck/protocol";

/** The background sessions' part of the app's state (#1596): each host's list, as `bg.list` gave it. */
export interface BackgroundSliceState {
  /** Phase 27: each host's Claude Code background sessions, as `bg.list` gave them. */
  background: Record<string, BgList>;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialBackgroundState = (): BackgroundSliceState => ({ background: {} });

/** What the background sessions read and ask through the app's store; a refusal comes back `null`. */
export interface BackgroundCore {
  state(): BackgroundSliceState;
  update(patch: Partial<BackgroundSliceState>): void;
  list(hostId: string): Promise<BgList | null>;
  stop(hostId: string, id: string): Promise<BgList | null>;
  respawn(hostId: string, id: string): Promise<BgList | null>;
  message(hostId: string, id: string, text: string): Promise<BgList | null>;
  /** Starts a session in the background; null when the host refuses. */
  start(hostId: string, payload: CommandPayload<"bg.start">): Promise<{ id: string } | null>;
  /** Opens a terminal on the host running `claude attach <id>` in the session's folder. */
  openTerminal(hostId: string, session: BgSession): Promise<{ terminalId: string } | null>;
  /** Shows a host's terminal as a tab. */
  showTerminal(hostId: string, terminalId: string): void;
}

/** Claude Code's own background sessions of each host (phase 27; #1596: a slice of the store). */
export class BackgroundSlice {
  constructor(private readonly core: BackgroundCore) {}

  /** Reads a host's background sessions (`claude agents`), for the hub and their screen. */
  async load(hostId: string): Promise<void> {
    await this.keep(hostId, this.core.list(hostId));
  }

  /** Stops or restarts a background session; the list comes back with the answer. */
  act(hostId: string, kind: "stop" | "respawn", id: string): Promise<boolean> {
    return this.keep(
      hostId,
      kind === "stop" ? this.core.stop(hostId, id) : this.core.respawn(hostId, id),
    );
  }

  /** Sends a message to a background session; false when the host refuses. */
  message(hostId: string, id: string, text: string): Promise<boolean> {
    return this.keep(hostId, this.core.message(hostId, id, text));
  }

  /** "Trazer para o terminal": `claude attach <id>` in a terminal tab of the host. */
  async attach(hostId: string, session: BgSession): Promise<string | null> {
    const opened = await this.core.openTerminal(hostId, session);
    if (!opened) return null;
    this.core.showTerminal(hostId, opened.terminalId);
    return opened.terminalId;
  }

  /** Starts a session in the background (`flightdeckd claude --bg`) and reads the list again. */
  async start(hostId: string, payload: CommandPayload<"bg.start">): Promise<string | null> {
    const started = await this.core.start(hostId, payload);
    if (!started) return null;
    await this.load(hostId);
    return started.id;
  }

  /** Keeps the list an answer brought; false when the host refused. */
  private async keep(hostId: string, answer: Promise<BgList | null>): Promise<boolean> {
    const list = await answer;
    if (!list) return false;
    this.core.update({ background: { ...this.core.state().background, [hostId]: list } });
    return true;
  }
}
