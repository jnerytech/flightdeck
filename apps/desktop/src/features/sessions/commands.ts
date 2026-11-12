import type { CommandPayload, EffortLevel, SessionImage, SettableMode } from "@flightdeck/protocol";
import { type HostConnection, RequestError } from "@/features/hosts/index.ts";
import type { Selection } from "../../lib/app-store.ts";
import { endMeasure, startMeasure } from "../costs/index.ts";

/** What the commands read and ask through the app's store. */
export interface SessionCommandsCore {
  /** The live connection to a host, if it has one. */
  connection(hostId: string): HostConnection | undefined;
  /** The session that is open, if any. */
  selected(): Selection | null;
  /** Shows a failure to the person; `retry` runs again what failed. */
  fail(error: unknown, text?: string, retry?: () => void): void;
  /** Opens a session the host just made: selects it, closes the search and shows it. */
  opened(hostId: string, sessionId: string): void;
}

/**
 * What a person asks of a session (#1596: a slice of the store): make one, send it a message,
 * interrupt it, change its mode, model or effort, close it, resume it. Each command goes to the
 * host of the open session; a refusal reaches the person through `fail`, never as a throw.
 */
export class SessionCommandsSlice {
  constructor(private readonly core: SessionCommandsCore) {}

  async create(hostId: string, payload: CommandPayload<"session.create">): Promise<string | null> {
    const conn = this.core.connection(hostId);
    if (!conn) {
      this.core.fail(new RequestError("offline", "unknown host, or no token"));
      return null;
    }
    try {
      const { sessionId } = await conn.request("session.create", payload);
      this.core.opened(hostId, sessionId);
      return sessionId;
    } catch (error) {
      this.core.fail(error, undefined, () => void this.create(hostId, payload));
      return null;
    }
  }

  async send(text: string, images?: SessionImage[]): Promise<void> {
    startMeasure("send");
    await this.onSelected((conn, sessionId) =>
      conn.request("session.send", { sessionId, text, ...(images?.length ? { images } : {}) }),
    );
    endMeasure("send");
  }

  interrupt(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.interrupt", { sessionId }));
  }

  /** Whether the host took the mode (#935): false when it refused (said why), or no session is open. */
  async setMode(permissionMode: SettableMode): Promise<boolean> {
    let taken = false;
    await this.onSelected(async (conn, sessionId) => {
      await conn.request("session.setMode", { sessionId, permissionMode });
      taken = true;
    });
    return taken;
  }

  setModel(model: string | null): Promise<void> {
    return this.onSelected((conn, sessionId) =>
      conn.request("session.setModel", { sessionId, model }),
    );
  }

  setEffort(effort: EffortLevel | null): Promise<void> {
    return this.onSelected((conn, sessionId) =>
      conn.request("session.setEffort", { sessionId, effort }),
    );
  }

  close(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.close", { sessionId }));
  }

  resume(): Promise<void> {
    return this.onSelected((conn, sessionId) => conn.request("session.resume", { sessionId }));
  }

  /** Runs `action` on the open session's host; nothing happens when no session is open. */
  async onSelected(
    action: (conn: HostConnection, sessionId: string) => Promise<unknown>,
  ): Promise<void> {
    const selected = this.core.selected();
    const conn = selected && this.core.connection(selected.hostId);
    if (!conn || !selected?.sessionId) return;
    try {
      await action(conn, selected.sessionId);
    } catch (error) {
      this.core.fail(error);
    }
  }
}
