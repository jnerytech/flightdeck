import { FlightdeckError } from "../kernel/index.ts";
import type { EndpointInfo, Endpoints } from "./endpoints.ts";
import type { MessagePatch } from "./store.ts";

export interface DeliveryOptions {
  endpoints: Endpoints;
  /** Records how a message ended; the service stamps the time. */
  settle: (id: string, patch: Omit<MessagePatch, "at">) => void;
}

/**
 * Hands a message to a session of this host and keeps the messages that cannot go yet: a managed
 * session in a turn takes its text when the turn ends, and a terminal waiting for a permission is
 * not written to until it leaves that state.
 */
export class Delivery {
  /** Managed messages waiting for their turn: the text that will reach the session, by message. */
  private readonly waiting = new Map<string, { to: string; formatted: string }>();
  /** Messages held for a terminal session that is waiting for a permission. */
  private readonly held = new Map<string, Array<{ id: string; formatted: string }>>();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly opts: DeliveryOptions) {
    this.unsubscribe.push(
      opts.endpoints.onUserMessage((id, text) => this.userMessage(id, text)),
      opts.endpoints.onState((id, state) => {
        if (state !== "waiting") this.release(id);
      }),
    );
  }

  /**
   * Gives the text to a session of this host. A terminal waiting for a permission is not written to
   * (a message must never end up answering the prompt): it is held until it leaves that state.
   */
  handOver(
    info: EndpointInfo,
    id: string,
    formatted: string,
  ): { status: "delivered" | "queued" } | { refusal: string } {
    const current = this.opts.endpoints.list().find((e) => e.id === info.id) ?? info;
    if (current.kind === "terminal" && current.state === "waiting") {
      const list = this.held.get(info.id) ?? [];
      list.push({ id, formatted });
      this.held.set(info.id, list);
      return { status: "queued" };
    }
    try {
      const status = this.opts.endpoints.send(info.id, formatted);
      if (status === "queued") this.waiting.set(id, { to: info.id, formatted });
      return { status };
    } catch (error) {
      if (error instanceof FlightdeckError) return { refusal: error.message };
      throw error;
    }
  }

  /** A terminal left `waiting`: what was held for it goes now. */
  private release(sessionId: string): void {
    const list = this.held.get(sessionId);
    if (!list) return;
    this.held.delete(sessionId);
    for (const item of list) {
      try {
        const status = this.opts.endpoints.send(sessionId, item.formatted);
        if (status === "queued") {
          this.waiting.set(item.id, { to: sessionId, formatted: item.formatted });
        } else {
          this.opts.settle(item.id, { status: "delivered" });
        }
      } catch (error) {
        this.opts.settle(item.id, { status: "refused", reason: (error as Error).message });
      }
    }
  }

  /** A user message reached a managed session: the queued message with that text was delivered. */
  private userMessage(sessionId: string, text: string): void {
    for (const [id, pending] of this.waiting) {
      if (pending.to === sessionId && pending.formatted === text) {
        this.waiting.delete(id);
        this.opts.settle(id, { status: "delivered" });
        return;
      }
    }
  }

  /** Suspends the automatic approval in a session that received third-party content. */
  suspend(sessionId: string): void {
    this.opts.endpoints.suspend(
      sessionId,
      "message from a session that received third-party content",
    );
  }

  stop(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }
}
