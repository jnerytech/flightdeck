import type { HostDraft } from "../ui/HostForm.tsx";
import type { ReaderTarget } from "../ui/TranscriptReader.tsx";

/** Every screen of the app, with what it shows. */
export type Route =
  /** The selected session, the new-session form of the selected host, or the hub. */
  | { name: "home" }
  | { name: "hub" }
  /** The requests waiting for the user (phase 10). */
  | { name: "needs-you" }
  | { name: "session"; host: string; id: string; focus?: string }
  | { name: "new-session"; host: string }
  | { name: "external"; host: string; claudeSessionId: string }
  /** A transcript; `list: "history"` when it was opened from a host's history list. */
  | { name: "reader"; target: ReaderTarget; list?: "history" }
  | { name: "history"; host: string }
  | { name: "host"; host: string }
  /** `focus`: the picker of Board or Workflows (a nav item), not the whole page. */
  | { name: "projects"; host: string; focus?: "board" | "workflows" }
  | { name: "board"; host: string; projectId: string }
  | { name: "card"; host: string; projectId: string; cardId: string }
  | { name: "workflows"; host: string; projectId: string; projectName: string }
  /** A project's agent: MCP servers, CLAUDE.md, agents and skills (phase 12). */
  | { name: "agent"; host: string; projectId: string; projectName: string }
  /** A project's automations (phase 13). */
  | { name: "automations"; host: string; projectId: string; projectName: string }
  /** A project's actions that use a vault secret (phase 17). */
  | { name: "actions"; host: string; projectId: string; projectName: string }
  /** The automatic approvals' decisions and suspended sessions of a host (phase 13). */
  | { name: "auto-approvals"; host: string }
  /** A host's embedded terminal (phase 14). */
  | { name: "terminal"; host: string; terminalId: string }
  | { name: "settings" }
  /** The Custos screen (phase 8, track A). */
  | { name: "costs" }
  /** The ssh destinos of the host that keeps them (phase 15). */
  /** `connect`: the destino to connect to as soon as the screen opens (from the palette). */
  | { name: "connections"; connect?: string }
  /** The vault (phase 16): secrets, their use and the encrypted backup. */
  | { name: "vault" }
  | { name: "add-host"; draft?: HostDraft; key?: number };

/** The route in use and a history to go back and forward through (Alt+←/→, mouse buttons). */
export class Router {
  private stack: Route[];
  private index = 0;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Route = { name: "home" }) {
    this.stack = [initial];
  }

  get current(): Route {
    return this.stack[this.index] as Route;
  }

  get canBack(): boolean {
    return this.index > 0;
  }

  get canForward(): boolean {
    return this.index < this.stack.length - 1;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Opens `route`; the screens ahead of the current one (after a back) are dropped. */
  push(route: Route): void {
    if (JSON.stringify(route) === JSON.stringify(this.current)) return;
    this.stack = [...this.stack.slice(0, this.index + 1), route];
    this.index = this.stack.length - 1;
    this.emit();
  }

  back(): void {
    if (!this.canBack) return;
    this.index--;
    this.emit();
  }

  forward(): void {
    if (!this.canForward) return;
    this.index++;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const NAMES: Record<Route["name"], true> = {
  home: true,
  hub: true,
  "needs-you": true,
  session: true,
  "new-session": true,
  external: true,
  reader: true,
  history: true,
  host: true,
  projects: true,
  board: true,
  card: true,
  workflows: true,
  agent: true,
  automations: true,
  "auto-approvals": true,
  terminal: true,
  settings: true,
  costs: true,
  connections: true,
  vault: true,
  "add-host": true,
};

/** The names a stored tab may carry: anything else is dropped when the tabs come back. */
export const ROUTE_NAMES: ReadonlySet<string> = new Set(Object.keys(NAMES));
