import type { CommandPayload, PermissionMode } from "@flightdeck/protocol";
import type { RememberedFolder } from "../../lib/new-session-prefs.ts";

/** The path of a subfolder under a root, joined with the root's own separator. */
export function joinPath(_root: string, _sub: string): string {
  return "";
}

/** The configured root that holds `path` (the longest one) and the rest of it as a subfolder; null when none holds it. */
export function underRoot(_path: string, _roots: readonly string[]): RememberedFolder | null {
  return { root: "", sub: "" };
}

/** The folder the form shows: the one picked, else the last one used here, else the host's first root. */
export function startFolder(_input: {
  roots: readonly string[];
  picked: string | null;
  typedSub: string | null;
  kept: RememberedFolder | undefined;
}): RememberedFolder {
  return { root: "", sub: "" };
}

/** The permission modes a session can start in on this host. */
export function sessionModes(_opencode: boolean, _allowBypass: boolean): PermissionMode[] {
  return [];
}

/** The mode and model the form starts from: what the last session chose while the form still offers it. */
export function startChoices(_last: { mode?: PermissionMode; model?: string } | undefined): {
  mode: PermissionMode;
  model: string;
} {
  return { mode: "plan", model: "x" };
}

/** What the form keeps after a session starts: an OpenCode session leaves the last mode and model alone. */
export function choicesToKeep(_input: {
  opencode: boolean;
  last: { mode: PermissionMode; model: string };
  mode: PermissionMode;
  model: string;
}): { mode: PermissionMode; model: string } {
  return { mode: "plan", model: "x" };
}

/** Whether More options opens by itself: for what would otherwise act unseen. */
export function opensMoreOptions(_sub: string, _opencode: boolean, _extraSet: boolean): boolean {
  return false;
}

/** A required prompt is still empty; OpenCode sessions are not started in the background. */
export function promptMissing(_required: boolean, _opencode: boolean, _prompt: string): boolean {
  return true;
}

/** What the host is asked to create: only the fields that are set. */
export function createPayload(_input: {
  cwd: string;
  prompt: string;
  mode: PermissionMode;
  model: string;
  name: string;
  opencode: boolean;
  effort: string;
}): CommandPayload<"session.create"> {
  return { cwd: "" };
}
