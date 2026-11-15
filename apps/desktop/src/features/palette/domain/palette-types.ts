import type { AppState } from "../../../lib/app-store.ts";
import type { Route } from "../../../lib/router.ts";
import type { SessionViewName as SessionView } from "../../sessions/index.ts";
import type { TerminalTarget } from "../../terminal/index.ts";

/** Where an entry of the Ctrl+K palette leads. */
export type PaletteTarget =
  | { kind: "session"; hostId: string; sessionId: string }
  | { kind: "external"; hostId: string; claudeSessionId: string }
  | { kind: "card"; hostId: string; projectId: string; cardId: string }
  | { kind: "board"; hostId: string; projectId: string }
  | { kind: "workflows"; hostId: string; projectId: string; name: string }
  | { kind: "host"; hostId: string }
  | { kind: "projects"; hostId: string }
  /** `persona`: a picker value (`host:<id>`) to open the form with (phase 20). */
  | { kind: "new-session"; hostId: string; persona?: string }
  | { kind: "terminal"; hostId: string; target: TerminalTarget }
  /** A new embedded terminal (phase 14), in a new tab. */
  | { kind: "new-terminal"; hostId: string }
  | { kind: "settings" }
  | { kind: "add-host" }
  | { kind: "toggle-theme" }
  | { kind: "toggle-ui-mode" }
  | { kind: "switch-language" }
  | { kind: "start-card"; hostId: string; cardId: string }
  | { kind: "costs" }
  /** A screen with no host: Sessions, Needs you or the Projects overview. */
  | { kind: "go"; to: "hub" | "needs-you" | "all-projects" | "activity" | "pull-requests" }
  /** The `?` sheet of shortcuts. */
  | { kind: "shortcuts" }
  /** Issue #107: a view of the session page on screen. */
  | { kind: "session-view"; view: SessionView }
  /**
   * The oldest request waiting for the person, named in the command (issue #187): an ordinary one
   * is answered; a gate, a vault request or a high-risk one is opened to be seen.
   */
  | {
      kind: "decide-oldest";
      decision: "approve" | "deny";
      /** `host/request` of the one the command named: a different oldest is never answered (#245). */
      key: string;
    }
  /** Phase 29: the Clients screen, and a switch of the client the screens show. */
  | { kind: "clients" }
  | { kind: "switch-client"; clientId: string }
  | { kind: "connect-ssh"; hostId: string; targetId: string }
  /** A snippet to fill and use: a host's, or a global one of the app (`hostId` null). */
  | { kind: "snippet"; hostId: string | null; snippetId: string }
  /** Issue #147: a card made from the text typed in the palette. */
  | { kind: "create-card"; hostId: string; projectId: string; title: string }
  /** Issue #1135: a session started in a project's folder with the typed text as its first prompt. */
  | { kind: "start-session"; hostId: string; cwd: string; prompt: string }
  /** A card made from an issue: `ref` when the text names the issue fully, else its `id` in the project. */
  | { kind: "create-card-issue"; hostId: string; projectId: string; ref?: string; id?: string }
  /** A pasted PR link (phase 22): the hosts that watch PRs are asked which card or session it is. */
  | { kind: "pull-link"; url: string };

export interface PaletteAction {
  label: string;
  target: PaletteTarget;
}

export interface PaletteItem {
  /** Unique within the palette. */
  id: string;
  label: string;
  detail: string;
  /** Enter. */
  target: PaletteTarget;
  /** Tab: what else can be done with it. */
  actions: PaletteAction[];
  /** The keys that do the same, as the sheet shows them (`g p`, `?`). */
  shortcut?: string;
  /** More text the query also matches, besides the label (a snippet's tags and content). */
  keywords?: string;
  /** A session's state, for its glyph: the key of `hub.stateDots`. */
  stateKey?: "running" | "needs_you" | "idle";
  /** The host and the project the entry belongs to, for the scope chips. */
  hostId?: string;
  projectId?: string;
}

export interface PaletteSection {
  title: string;
  items: PaletteItem[];
  /** The recent entries: they take Alt+1 to Alt+6. */
  recent?: true;
  /** Shown whole, never cut at the section cap (the clients: one switches between all of them). */
  uncapped?: true;
}

/** The host and project the palette is narrowed to; both null is no scope. */
export interface PaletteScope {
  hostId: string | null;
  projectId: string | null;
}

/** The scope the palette opens with: where the person is (a board or card: its project; else its host). */
export function paletteScope(route: Route, state: AppState): PaletteScope {
  if (route.name === "board" || route.name === "card") {
    return { hostId: route.host, projectId: route.projectId };
  }
  const hostId = "host" in route && typeof route.host === "string" ? route.host : null;
  return { hostId: state.hosts.some((h) => h.id === hostId) ? hostId : null, projectId: null };
}
