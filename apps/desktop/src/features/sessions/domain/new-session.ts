import type { CommandPayload, EffortLevel, PermissionMode } from "@flightdeck/protocol";
import { isInside, trimTrailingSeparators } from "@/shared/lib/index.ts";
import { CLAUDE_MODELS, type RememberedFolder } from "../new-session-prefs.ts";

const MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

/** Phase 39: what an OpenCode session can start in (Flightdeck's own two agents, and bypass). */
const OPENCODE_MODES: PermissionMode[] = ["default", "plan", "bypassPermissions"];

/** The path of a subfolder under a root, joined with the root's own separator. */
export function joinPath(root: string, sub: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  const clean = sub.trim().replace(/^[\\/]+/, "");
  return clean ? `${trimTrailingSeparators(root)}${sep}${clean}` : root;
}

/** The configured root that holds `path` (the longest one) and the rest of it as a subfolder; null when none holds it. */
export function underRoot(path: string, roots: readonly string[]): RememberedFolder | null {
  const holder = roots.filter((r) => isInside(path, r)).sort((a, b) => b.length - a.length)[0];
  if (!holder) return null;
  return {
    root: holder,
    sub: path.slice(trimTrailingSeparators(holder).length).replace(/^[\\/]+/, ""),
  };
}

/**
 * The folder the form shows: the one picked, else the last one used here (while the host still allows
 * its root), else the host's first root. The subfolder typed wins; before that, the remembered one,
 * and only together with the remembered folder.
 */
export function startFolder(input: {
  roots: readonly string[];
  picked: string | null;
  typedSub: string | null;
  kept: RememberedFolder | undefined;
}): RememberedFolder {
  const { roots, picked, typedSub, kept } = input;
  const keptHere = kept && roots.includes(kept.root) ? kept : undefined;
  return {
    root: picked ?? keptHere?.root ?? roots[0] ?? "",
    sub: typedSub ?? (picked === null && keptHere ? keptHere.sub : ""),
  };
}

/** The permission modes a session can start in on this host: bypass only where the host allows it. */
export function sessionModes(opencode: boolean, allowBypass: boolean): PermissionMode[] {
  return (opencode ? OPENCODE_MODES : MODES).filter(
    (mode) => allowBypass || mode !== "bypassPermissions",
  );
}

/** What the last session chose, while it is still a choice the form offers; else the default. */
function rememberedOr<T>(value: T | undefined, offered: readonly T[], fallback: T): T {
  return value !== undefined && offered.includes(value) ? value : fallback;
}

/** The mode and model the form starts from: what the last session chose, while the form still offers it. */
export function startChoices(last: { mode?: PermissionMode; model?: string } | undefined): {
  mode: PermissionMode;
  model: string;
} {
  return {
    mode: rememberedOr(last?.mode, MODES, "default"),
    model: rememberedOr<string>(last?.model, CLAUDE_MODELS, ""),
  };
}

/** What the form keeps after a session starts: OpenCode's modes and models are its own, so such a session leaves the last ones alone. */
export function choicesToKeep(input: {
  opencode: boolean;
  last: { mode: PermissionMode; model: string };
  mode: PermissionMode;
  model: string;
}): { mode: PermissionMode; model: string } {
  const { opencode, last, mode, model } = input;
  return opencode ? { mode: last.mode, model: last.model } : { mode, model };
}

/** Whether More options opens by itself: for what would otherwise act unseen (a subfolder, OpenCode, a setting of the screen's own). */
export function opensMoreOptions(sub: string, opencode: boolean, extraSet: boolean): boolean {
  return sub !== "" || opencode || extraSet;
}

/** A required prompt is still empty; OpenCode sessions are not started in the background. */
export function promptMissing(required: boolean, opencode: boolean, prompt: string): boolean {
  return required && !opencode && prompt.trim() === "";
}

/** What the host is asked to create: only the fields that are set, trimmed. */
export function createPayload(input: {
  cwd: string;
  prompt: string;
  mode: PermissionMode;
  model: string;
  name: string;
  opencode: boolean;
  effort: EffortLevel | "";
}): CommandPayload<"session.create"> {
  const { cwd, prompt, mode, model, name, opencode, effort } = input;
  return {
    cwd,
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    permissionMode: mode,
    ...(model ? { model } : {}),
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(opencode ? { runtime: "opencode" as const, ...(effort ? { effort } : {}) } : {}),
  };
}
