import type { Route } from "../../lib/router.ts";
import type { PaletteTarget } from "./palette.ts";

/** The palette's targets that act in place instead of opening a screen. */
type InPlace =
  | "terminal"
  | "new-terminal"
  | "toggle-theme"
  | "toggle-ui-mode"
  | "switch-language"
  | "start-card"
  | "create-card"
  | "create-card-issue"
  | "start-session"
  | "snippet"
  | "pull-link"
  | "switch-client"
  | "shortcuts"
  | "session-view"
  | "decide-oldest";

/** The screen of a palette target that opens one. */
export function paletteRoute(target: Exclude<PaletteTarget, { kind: InPlace }>): Route {
  switch (target.kind) {
    case "session":
      return { name: "session", host: target.hostId, id: target.sessionId };
    case "new-session":
      return {
        name: "new-session",
        host: target.hostId,
        ...(target.persona ? { persona: target.persona } : {}),
      };
    case "external":
      return { name: "external", host: target.hostId, claudeSessionId: target.claudeSessionId };
    case "card":
      return {
        name: "card",
        host: target.hostId,
        projectId: target.projectId,
        cardId: target.cardId,
      };
    case "board":
      return { name: "board", host: target.hostId, projectId: target.projectId };
    case "workflows":
      return {
        name: "workflows",
        host: target.hostId,
        projectId: target.projectId,
        projectName: target.name,
      };
    case "host":
      return { name: "host", host: target.hostId };
    case "projects":
      return { name: "projects", host: target.hostId };
    case "settings":
      return { name: "settings" };
    case "add-host":
      return { name: "add-host" };
    case "costs":
      return { name: "costs" };
    case "go":
      return { name: target.to };
    case "connect-ssh":
      return { name: "connections", connect: target.targetId };
    case "clients":
      return { name: "clients" };
  }
}
