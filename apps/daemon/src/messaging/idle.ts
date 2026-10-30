/**
 * Phase 21: "tell me when that session finishes its turn", once. The watcher gets a notice from
 * Flightdeck when the target session goes idle (the end of a managed turn, the Stop of a terminal),
 * at once when it already is, and never a second time for the same subscription.
 */
import type { SessionIdentity } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { Endpoints } from "./endpoints.ts";
import type { Messaging } from "./messages.ts";
import { addressOf } from "./policy.ts";

export interface IdleFrame {
  type: "idle.fired";
  /** The session that asked to be told, and the one it was waiting for (addresses). */
  watcher: string;
  session: string;
  at: string;
}

export interface IdleOptions {
  endpoints: Endpoints;
  messaging: Messaging;
  host: string;
  clock?: (() => number) | undefined;
}

interface Subscription {
  watcher: string;
  target: string;
  targetName: string | null;
}

export class Idle {
  private readonly subscriptions: Subscription[] = [];
  private readonly listeners = new Set<(frame: IdleFrame) => void>();
  private readonly off: () => void;

  constructor(private readonly opts: IdleOptions) {
    this.off = opts.endpoints.onIdle((id) => this.fire(id));
  }

  watch(listener: (frame: IdleFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribes once; `fired` is true when the session was already idle and the notice went now. */
  subscribe(input: { as: SessionIdentity; session: string }): { fired: boolean } {
    const { sender, target, info } = this.opts.messaging.inspect(input.as, input.session);
    if (!info) {
      throw new FlightdeckError(
        "invalid_state",
        `a sessão ${addressOf(target)} é de outro host: o aviso de ocioso só vale para sessões deste host`,
      );
    }
    const subscription: Subscription = {
      watcher: sender.id,
      target: target.id,
      targetName: target.name,
    };
    if (info.state === "idle" || info.state === "ended") {
      this.notify(subscription, info.state === "ended" ? "terminou" : "ociosa");
      return { fired: true };
    }
    const repeated = this.subscriptions.some(
      (s) => s.watcher === subscription.watcher && s.target === subscription.target,
    );
    if (!repeated) this.subscriptions.push(subscription);
    return { fired: false };
  }

  /** How many subscriptions are waiting. */
  pending(): number {
    return this.subscriptions.length;
  }

  stop(): void {
    this.off();
    this.subscriptions.length = 0;
    this.listeners.clear();
  }

  private fire(target: string): void {
    const due = this.subscriptions.filter((s) => s.target === target);
    for (const subscription of due) {
      this.subscriptions.splice(this.subscriptions.indexOf(subscription), 1);
      this.notify(subscription, "ociosa");
    }
  }

  private notify(subscription: Subscription, what: "ociosa" | "terminou"): void {
    const name = subscription.targetName ?? subscription.target;
    const address = `${this.opts.host}/${subscription.target}`;
    const text =
      what === "terminou"
        ? `A sessão "${name}" (${address}) terminou.`
        : `A sessão "${name}" (${address}) terminou o turno e está ociosa.`;
    this.opts.messaging.notice(subscription.watcher, "idle", text);
    const frame: IdleFrame = {
      type: "idle.fired",
      watcher: `${this.opts.host}/${subscription.watcher}`,
      session: address,
      at: new Date((this.opts.clock ?? Date.now)()).toISOString(),
    };
    for (const listener of this.listeners) listener(frame);
  }
}
