/**
 * Issue #1507: what `flightdeckd card` says and refuses, as pure rules over the cards, the projects and
 * the address of the config. The daemon calls and the timer stay in `board/card-cli.ts`.
 */
import { BoardColumn, type Card, type Project } from "@flightdeck/protocol";

export interface CardCliArgs {
  action:
    | "list"
    | "show"
    | "new"
    | "start"
    | "move"
    | "update"
    | "stop"
    | "complete"
    | "delete"
    | "discard";
  /** `--project`: an id or a name; without it, the only project of the host. */
  project?: string;
  /** `show` and `start`: the card. */
  id?: string;
  /** `new`: the title. */
  title?: string;
  description?: string;
  /** `start --workflow`. */
  workflow?: string;
  /** `move`: the column, `--position` in it and `--force` past its contract. */
  column?: string;
  position?: number;
  force?: boolean;
  /** `complete|delete|discard --confirm`: the person's yes, which the daemon asks for. */
  confirm?: boolean;
  /** `update`: what changes; `none` clears the estimate, the note, the spec path and the blockers. */
  estimate?: string;
  validationNote?: string;
  specPath?: string;
  blockedBy?: string;
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

/** The column a word names; a word the board does not have is refused with the ones it has. */
export function columnOf(wanted: string | undefined): BoardColumn {
  const found = BoardColumn.safeParse(wanted);
  if (found.success) return found.data;
  throw new Refusal(
    `"${wanted ?? ""}" is not a column: the columns are ${BoardColumn.options.join(", ")}`,
  );
}

/** The yes the daemon asks for in `complete`, `discard` and `delete`: nothing is sent without it. */
export function confirmed(args: CardCliArgs): true {
  if (args.confirm) return true;
  throw new Refusal(
    `card ${args.action} cannot be undone: pass --confirm to do it (the card is ${args.id ?? ""})`,
  );
}

const NONE = "none";

function hours(text: string): number | null {
  if (text === NONE) return null;
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < 0 || value > 1000)
    throw new Refusal(`--estimate: a number of hours from 0 to 1000, or "${NONE}" to clear it`);
  return value;
}

/** What `card update` changes: only the flags given; `none` clears what the card lets be cleared. */
export function updateOf(args: CardCliArgs) {
  const patch = {
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.estimate === undefined ? {} : { estimateHours: hours(args.estimate) }),
    ...(args.validationNote === undefined
      ? {}
      : { validationNote: args.validationNote === NONE ? null : args.validationNote }),
    ...(args.specPath === undefined
      ? {}
      : { specPath: args.specPath === NONE ? null : args.specPath }),
    ...(args.blockedBy === undefined
      ? {}
      : {
          blockedBy:
            args.blockedBy === NONE
              ? []
              : args.blockedBy
                  .split(",")
                  .map((id) => id.trim())
                  .filter(Boolean),
        }),
  };
  if (Object.keys(patch).length === 0)
    throw new Refusal(
      "nothing to update: pass --title, --description, --estimate, --validation-note, --spec-path or --blocked-by",
    );
  return patch;
}

/** What a write that got no answer may have done. */
export const UNSURE: Partial<Record<CardCliArgs["action"], string>> = {
  new: "; the card may or may not have been created: check with `card list` before trying again",
  start: "; the card may or may not have been started: check with `card show` before trying again",
  move: "; the card may or may not have been moved: check with `card show` before trying again",
  update: "; the card may or may not have been updated: check with `card show` before trying again",
  stop: "; the card may or may not have been stopped: check with `card show` before trying again",
  complete:
    "; the card may or may not have been completed: check with `card show` before trying again",
  discard:
    "; the card may or may not have been discarded: check with `card list` before trying again",
  delete: "; the card may or may not have been deleted: check with `card list` before trying again",
};
