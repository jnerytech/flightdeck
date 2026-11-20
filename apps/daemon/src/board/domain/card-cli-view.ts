/**
 * Issue #1507: what `flightdeckd card` says and refuses, as pure rules over the cards, the projects and
 * the address of the config. The daemon calls and the timer stay in `board/card-cli.ts`.
 */
import {
  BoardColumn,
  type Card,
  type CardDiff,
  type CardReviewResult,
  type CardTemplates,
  type Project,
  type ValidationTemplate,
} from "@flightdeck/protocol";

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
    | "discard"
    | "diff"
    | "spec"
    | "review"
    | "message"
    | "templates"
    | "validation-template"
    | "pr-create"
    | "update-from-base"
    | "merge-local";
  /** `message`: the text; `review --language`. */
  text?: string;
  language?: "en" | "pt-BR";
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
  /** `complete|delete|discard|merge-local --confirm`: the person's yes, which the daemon asks for. */
  confirm?: boolean;
  /** `merge-local`: one commit instead of a merge commit, and the message the person typed for it. */
  squash?: boolean;
  message?: string;
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

/** The yes the daemon asks for in `complete`, `discard`, `delete` and `merge-local`: nothing is sent without it. */
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
  if (!/^\d+(\.\d+)?$/.test(text) || value > 1000)
    throw new Refusal(`--estimate: a number of hours from 0 to 1000, or "${NONE}" to clear it`);
  return value;
}

/** `--blocked-by a,b`: the ids, or `none` for no blocker; an empty list is a mistake, not a clear. */
function blockers(text: string): string[] {
  if (text === NONE) return [];
  const ids = text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0)
    throw new Refusal(`--blocked-by: a comma-separated list of card ids, or "${NONE}" to clear it`);
  return ids;
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
    ...(args.blockedBy === undefined ? {} : { blockedBy: blockers(args.blockedBy) }),
  };
  if (Object.keys(patch).length === 0)
    throw new Refusal(
      "nothing to update: pass --title, --description, --estimate, --validation-note, --spec-path or --blocked-by",
    );
  return patch;
}

/** `message`: the text, which the daemon refuses when empty; nothing is sent then. */
export function textOf(args: CardCliArgs): string {
  if (args.text?.trim()) return args.text;
  throw new Refusal("card message: the text is empty");
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** What a file's header says about its hunks: why they are not shown, or the lines it adds and removes. */
function fileDetail(file: CardDiff["files"][number]): string {
  if (file.secret) return "may hold a credential: not shown";
  if (file.tooLarge) return `too large: ${file.bytes ?? 0} bytes, not shown`;
  if (file.binary) return "binary";
  return `+${file.additions} -${file.deletions}`;
}

/** The diff of a card as text: a header per file, then its hunks as git prints them. */
export function diffLines({ base, files }: CardDiff): string[] {
  if (files.length === 0) return [`no changes against ${base}`];
  return [
    `diff against ${base}`,
    ...files.flatMap((file) => {
      const what =
        file.status === "renamed" && file.oldPath ? `renamed from ${file.oldPath}` : file.status;
      const shown = !file.secret && !file.tooLarge && !file.binary;
      const detail = fileDetail(file);
      return [
        `--- ${file.path} (${what}, ${detail})`,
        // The daemon sends no lines for a file it hides; the reader never relies on that alone.
        ...(shown ? file.hunks : []).flatMap((hunk) => [
          hunk.header,
          ...hunk.lines.map((line) => `${line.op}${line.text}`),
        ]),
      ];
    }),
  ];
}

/** What the card's spec file is, after the daemon looked at it again. */
export function specLines(card: Card): string[] {
  const spec = card.specState;
  if (!spec) return [`${card.id}  has no spec file`];
  if (!spec.found) return [`${card.id}  spec ${spec.path}: file not found`];
  return [
    `${card.id}  spec ${spec.path}`,
    ...(spec.heading ? [`heading: ${spec.heading}`] : []),
    ...(spec.draft ? ["draft: yes"] : []),
  ];
}

/** A review in words: what the reviewer said, and the findings that sit on no changed line. */
export function reviewLines(id: string, review: CardReviewResult): string[] {
  const notes = [
    ...(review.cached ? ["cached"] : []),
    ...(review.moved ? ["the card was moved"] : []),
  ];
  const noted = notes.length ? ` (${notes.join(", ")})` : "";
  return [
    `review of ${id}: ${review.state}${noted}`,
    ...review.summary.split("\n"),
    ...(review.anchored > 0
      ? [
          `${review.anchored} ${plural(review.anchored, "finding", "findings")} anchored to the diff as a review comment`,
        ]
      : []),
    ...review.loose.map((f) => `${f.severity}  ${f.path}:${f.line}  ${f.body}`),
  ];
}

/** The card templates of a project, and what the host left out of its file. */
export function templatesLines(project: Project, found: CardTemplates): string[] {
  const lines = [
    ...found.templates.map((template) => `${template.id}  ${template.name}`),
    ...(found.dropped > 0
      ? [
          `${found.dropped} ${plural(found.dropped, "entry", "entries")} of the templates file ${plural(found.dropped, "was", "were")} left out`,
        ]
      : []),
    ...(found.ignored ? [`the templates file was not used: ${found.ignored}`] : []),
  ];
  return lines.length > 0 ? lines : [`no card templates in ${project.name}`];
}

/** The project's own shape for a validation note, or why it was not used. */
export function validationLines(found: ValidationTemplate): string[] {
  if (found.text !== null) return found.text.split("\n");
  if (found.ignored) return [`the project's validation template was not used: ${found.ignored}`];
  return ["the project has no validation template"];
}

/** What a write that got no answer may have done. */
export const UNSURE: Partial<Record<CardCliArgs["action"], string>> = {
  "pr-create":
    "; the pull request may or may not have been opened: check with `card show` before trying again",
  "update-from-base":
    "; the card may or may not have been rebased: check with `card show` before trying again",
  "merge-local":
    "; the card may or may not have been merged: check with `card show` before trying again",
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
  review:
    "; the review may or may not have been done, and the card may have moved: check with `card show` before trying again",
  message:
    "; the message may or may not have been sent: check with `card show` before trying again",
};
