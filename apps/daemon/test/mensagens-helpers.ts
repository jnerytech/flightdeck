import type { MessagingSession, SessionLine } from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import type { EndpointInfo, Endpoints, ReadMessage } from "../src/messaging/endpoints.ts";
import {
  Messaging,
  type MessagingFrame,
  type MessagingOptions,
} from "../src/messaging/messages.ts";
import { EventStore } from "../src/store/event-store.ts";

export const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const PROJECT = "github.com/acme/app";

type State = MessagingSession["state"];

/** The sessions of a host, as the messaging layer sees them, and what happens to them. */
export class FakeEndpoints implements Endpoints {
  readonly infos = new Map<string, EndpointInfo>();
  readonly launches = new Map<string, string>();
  readonly sent: Array<{ id: string; text: string }> = [];
  readonly suspended: Array<{ id: string; reason: string }> = [];
  readonly untrustedIds = new Set<string>();
  /** Sessions in the middle of a turn: they queue what they get. */
  readonly busy = new Set<string>();
  readonly transcripts = new Map<
    string,
    { summary: SessionLine | null; messages: ReadMessage[] }
  >();
  private readonly idleListeners = new Set<(id: string) => void>();
  private readonly userListeners = new Set<(id: string, text: string) => void>();
  private readonly stateListeners = new Set<(id: string, state: State) => void>();

  add(id: string, over: Partial<EndpointInfo> = {}): EndpointInfo {
    const info: EndpointInfo = {
      id,
      kind: "managed",
      name: id,
      persona: null,
      projectKey: PROJECT,
      state: "idle",
      controllable: true,
      reason: null,
      ...over,
    };
    this.infos.set(id, info);
    return info;
  }

  list(): EndpointInfo[] {
    return [...this.infos.values()];
  }

  byLaunch(launchId: string): string | null {
    return this.launches.get(launchId) ?? null;
  }

  send(id: string, text: string): "delivered" | "queued" {
    const info = this.infos.get(id);
    if (!info) throw new FlightdeckError("not_found", `sessão ${id} não existe`);
    if (!info.controllable) throw new FlightdeckError("invalid_state", info.reason ?? "sem canal");
    this.sent.push({ id, text });
    return this.busy.has(id) ? "queued" : "delivered";
  }

  untrusted(id: string): boolean {
    return this.untrustedIds.has(id);
  }

  suspend(id: string, reason: string): void {
    this.suspended.push({ id, reason });
  }

  onIdle(listener: (id: string) => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  onUserMessage(listener: (id: string, text: string) => void): () => void {
    this.userListeners.add(listener);
    return () => this.userListeners.delete(listener);
  }

  onState(listener: (id: string, state: State) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  read(id: string, last: number) {
    const found = this.transcripts.get(id);
    if (!found) return this.infos.has(id) ? { summary: null, messages: [] } : null;
    return { summary: found.summary, messages: found.messages.slice(-last) };
  }

  // --- what a test makes happen ---

  setState(id: string, state: State): void {
    const info = this.infos.get(id);
    if (info) info.state = state;
    for (const listener of this.stateListeners) listener(id, state);
    if (state === "idle") for (const listener of this.idleListeners) listener(id);
  }

  /** The session took a queued text into a turn. */
  userMessage(id: string, text: string): void {
    for (const listener of this.userListeners) listener(id, text);
  }
}

export function setup(over: Partial<MessagingOptions> = {}) {
  const endpoints = new FakeEndpoints();
  const store = new EventStore(":memory:");
  const now = { at: NOW };
  const teams = new Map<string, string>();
  const messaging = new Messaging({
    db: store.db,
    host: "pc",
    endpoints,
    clock: () => now.at,
    teamOf: (id) => teams.get(id) ?? null,
    ...over,
  });
  const frames: MessagingFrame[] = [];
  const unwatch = messaging.watch((frame) => frames.push(frame));
  return { messaging, endpoints, store, now, teams, frames, unwatch };
}

/** Two daemons that only know their own sessions, joined the way the app joins them. */
export function twoHosts() {
  const now = { at: NOW };
  const clock = () => now.at;
  return { a: setup({ host: "pc", clock }), b: setup({ host: "wsl", clock }), now };
}

export const failure = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};
