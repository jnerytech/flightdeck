/**
 * Issue #1507: what `flightdeckd card` says and refuses, as pure rules over the cards, the projects and
 * the address of the config. The daemon calls and the timer stay in `board/card-cli.ts`.
 */
import type { Card, Project } from "@flightdeck/protocol";

export interface CardCliArgs {
  action: "list" | "show" | "new" | "start";
  /** `--project`: an id or a name; without it, the only project of the host. */
  project?: string;
  /** `show` and `start`: the card. */
  id?: string;
  /** `new`: the title. */
  title?: string;
  description?: string;
  /** `start --workflow`. */
  workflow?: string;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** An answer to give as exit 1: nothing the daemon or the person did wrong is an exception to show. */
class Refusal extends Error {}

const WAITS: Record<string, string> = {
  slot: "waiting for a free slot",
  quota: "waiting for the plan quota to reset",
  memory: "waiting for the host's memory",
  budget: "waiting for the budget",
  paused: "the host is paused",
};

/** Why a card has not started, in words; null when nothing holds it. */
export function waitOf(card: Card): string | null {
  if (card.queued) {
    const reason = card.queueReason ?? "slot";
    // A daemon newer than this command may know a reason it does not: say it as it came.
    const base = WAITS[reason] ?? `waiting (${reason})`;
    if (card.queueReason === "quota" && card.quotaUntil)
      return `${base} (until ${card.quotaUntil})`;
    return base;
  }
  const blockers = card.waitingOn?.length ?? 0;
  if (blockers === 0) return null;
  const noun = blockers === 1 ? "card" : "cards";
  return `waiting for ${blockers} ${noun} to be done first`;
}

const names = (projects: Project[]) => projects.map((project) => project.name).join(", ");

/** The project a name or id points to; without a name, the only one the host has. */
export function pick(projects: Project[], wanted: string | undefined): Project {
  if (wanted === undefined) {
    const [only] = projects;
    if (projects.length === 1 && only) return only;
    throw new Refusal(
      projects.length === 0
        ? "this host has no projects yet"
        : `this host has several projects: pass --project <name or id> (${names(projects)})`,
    );
  }
  const byId = projects.find((project) => project.id === wanted);
  if (byId) return byId;
  const named = projects.filter((project) => project.name.toLowerCase() === wanted.toLowerCase());
  const [first] = named;
  if (named.length === 1 && first) return first;
  if (named.length > 1)
    throw new Refusal(
      `"${wanted}" is the name of several projects: use the id (${named.map((p) => p.id).join(", ")})`,
    );
  throw new Refusal(`no project named "${wanted}"; the projects here: ${names(projects)}`);
}

/** What a write that got no answer may have done. */
export const UNSURE: Partial<Record<CardCliArgs["action"], string>> = {
  new: "; the card may or may not have been created: check with `card list` before trying again",
  start: "; the card may or may not have been started: check with `card show` before trying again",
};
