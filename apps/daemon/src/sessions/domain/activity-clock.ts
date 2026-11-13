import type { SessionEvent } from "@flightdeck/protocol";

/** The last tool a session called, and whether that call (or another) is still open. */
export interface ToolNote {
  name: string | null;
  inFlight: boolean;
}

interface Entry {
  at: number;
  tool: string | null;
  open: Set<string>;
}

/**
 * When each session last produced an event of any kind (a streamed delta included, which the store
 * never persists) and which tool call it has open. The stall watcher reads it.
 */
export class ActivityClock {
  private readonly entries = new Map<string, Entry>();

  observe(sessionId: string, event: SessionEvent, at: number): void {
    const entry = this.entries.get(sessionId) ?? { at, tool: null, open: new Set<string>() };
    entry.at = at;
    if (event.type === "message.assistant") {
      for (const block of event.blocks) {
        if (block.type !== "tool_use") continue;
        entry.open.add(block.id);
        entry.tool = block.name;
      }
    } else if (event.type === "tool.result") {
      entry.open.delete(event.toolUseId);
    } else if (event.type === "turn.result") {
      // A call that never got a result ended with its turn.
      entry.open.clear();
    }
    this.entries.set(sessionId, entry);
  }

  /** Milliseconds since the epoch of the last event; `null` for a session never observed. */
  lastEventAt(sessionId: string): number | null {
    return this.entries.get(sessionId)?.at ?? null;
  }

  tool(sessionId: string): ToolNote {
    const entry = this.entries.get(sessionId);
    return { name: entry?.tool ?? null, inFlight: (entry?.open.size ?? 0) > 0 };
  }

  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}
