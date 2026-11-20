/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  failure,
  json,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  arenaLines,
  type CardCliArgs,
  columnOf,
  confirmed,
  diffLines,
  loopLine,
  pick,
  reviewLines,
  specLines,
  templatesLines,
  textOf,
  UNSURE,
  updateOf,
  validationLines,
  variantsOf,
  waitOf,
} from "./domain/card-cli-view.ts";

export interface CardCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** A review asks a model for a second opinion: it takes minutes, not seconds. */
const REVIEW_TIMEOUT_MS = 300_000;

type Note = { wrote: boolean };

async function listCards(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const chosen = args.project === undefined ? projects : [pick(projects, args.project)];
  const boards = await Promise.all(
    chosen.map((project) => daemon.call("board.get", { projectId: project.id })),
  );
  const rows = boards.flatMap((board) =>
    board.columns.flatMap(({ column, cards }) =>
      cards.map((card) => ({ project: board.project.name, column, card })),
    ),
  );
  if (args.json)
    return json(
      rows.map(({ project, column, card }) => ({
        project,
        id: card.id,
        title: card.title,
        column,
        queued: card.queued,
        queueReason: card.queueReason,
      })),
    );
  return said(
    ...rows.map(({ project, column, card }) => {
      const wait = waitOf(card);
      const tail = wait === null ? "" : ` (${wait})`;
      return `${project}  ${card.id}  ${column}  ${card.title}${tail}`;
    }),
  );
}

async function showCard(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const card = await daemon.call("card.get", { cardId: args.id ?? "" });
  if (args.json) return json(card);
  const wait = waitOf(card);
  return said(
    `${card.id}  ${card.title}`,
    `column: ${card.column}`,
    ...(card.branch ? [`branch: ${card.branch}`] : []),
    ...(card.prUrl ? [`pr: ${card.prUrl}`] : []),
    ...(wait ? [`waiting: ${wait}`] : []),
    ...(card.notice ? [`notice: ${card.notice}`] : []),
  );
}

async function newCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const project = pick(projects, args.project);
  note.wrote = true;
  const card = await daemon.call("card.create", {
    projectId: project.id,
    title: args.title ?? "",
    description: args.description ?? "",
  });
  return args.json ? json(card) : said(`created ${card.id}  ${card.title}`);
}

async function startCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  note.wrote = true;
  const card = await daemon.call("card.start", {
    cardId: args.id ?? "",
    ...(args.workflow ? { workflow: args.workflow } : {}),
  });
  if (args.json) return json(card);
  const wait = waitOf(card);
  return said(
    wait ? `queued ${card.id}  ${card.title}: ${wait}` : `started ${card.id}  ${card.title}`,
  );
}

async function moveCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const column = columnOf(args.column);
  note.wrote = true;
  const card = await daemon.call("card.move", {
    cardId: args.id ?? "",
    column,
    ...(args.position === undefined ? {} : { position: args.position }),
    ...(args.force ? { force: true } : {}),
  });
  if (args.json) return json(card);
  return said(
    `moved ${card.id} to ${card.column}`,
    ...(card.notice ? [`notice: ${card.notice}`] : []),
  );
}

async function updateCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const patch = updateOf(args);
  note.wrote = true;
  const card = await daemon.call("card.update", { cardId: args.id ?? "", ...patch });
  return args.json ? json(card) : said(`updated ${card.id}  ${card.title}`);
}

async function stopCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  note.wrote = true;
  const card = await daemon.call("card.stop", { cardId: args.id ?? "" });
  return args.json ? json(card) : said(`stopped ${card.id}  ${card.title}`);
}

/** `complete`, `discard` and `delete` cannot be undone: the daemon asks for the person's yes, and so does this. */
async function endCard(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
  done: "completed" | "discarded" | "deleted",
): Promise<CliResult> {
  const confirm = confirmed(args);
  const payload = { cardId: args.id ?? "", confirm };
  note.wrote = true;
  const card = await (done === "completed"
    ? daemon.call("card.complete", payload)
    : done === "discarded"
      ? daemon.call("card.discard", payload)
      : daemon.call("card.delete", payload));
  return args.json ? json(card) : said(`${done} ${card.id}  ${card.title}`);
}

/** Pushes the card's branch and opens its pull request: public, so a write the person cannot take back. */
async function prOfCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  note.wrote = true;
  const card = await daemon.call("card.pr.create", {
    cardId: args.id ?? "",
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.description === undefined ? {} : { description: args.description }),
  });
  return args.json
    ? json(card)
    : said(`opened the PR of ${card.id}  ${card.prUrl ?? ""}`.trimEnd());
}

async function rebaseCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  note.wrote = true;
  const card = await daemon.call("card.updateFromBase", { cardId: args.id ?? "" });
  return args.json ? json(card) : said(`updated ${card.id} from its base branch`);
}

/** Merges the card into its base and removes its worktree and branch: the daemon asks for the yes, and so does this. */
async function mergeCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const confirm = confirmed(args);
  note.wrote = true;
  const card = await daemon.call("card.mergeLocal", {
    cardId: args.id ?? "",
    mode: args.squash ? "squash" : "merge",
    confirm,
    ...(args.message === undefined ? {} : { message: args.message }),
  });
  return args.json ? json(card) : said(`merged ${card.id}  ${card.title}`);
}

async function arenaOf(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const arena = await daemon.call("card.arena", { cardId: args.id ?? "" });
  return args.json ? json(arena) : said(...arenaLines(arena));
}

/** The same request in 2 to 4 variants, each in its own worktree and session: it spends the plan, like `start`. */
async function startArena(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const variants = variantsOf(args.variants);
  note.wrote = true;
  const arena = await daemon.call("card.startArena", {
    cardId: args.id ?? "",
    variants,
    ...(args.workflow ? { workflow: args.workflow } : {}),
  });
  return args.json ? json(arena) : said(...arenaLines(arena, true));
}

/** Keeps one variant as the card's worktree and removes the others: the daemon asks for the yes, and so does this. */
async function chooseVariant(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
): Promise<CliResult> {
  const confirm = confirmed(args);
  note.wrote = true;
  const card = await daemon.call("card.chooseVariant", {
    cardId: args.id ?? "",
    variantId: args.variant ?? "",
    confirm,
  });
  return args.json ? json(card) : said(`chose ${args.variant ?? ""} for ${card.id}  ${card.title}`);
}

/** The loop runs the checks on its own: the daemon decides whether turning it on needs the person's yes. */
async function checkLoop(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  const on = args.loop === "on";
  note.wrote = true;
  const card = await daemon.call("card.checkLoop", {
    cardId: args.id ?? "",
    on,
    ...(args.rounds === undefined ? {} : { rounds: args.rounds }),
    ...(args.confirm ? { confirm: true } : {}),
  });
  return args.json ? json(card) : said(loopLine(card.id, on, args.rounds));
}

async function dismissUnblocked(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
): Promise<CliResult> {
  note.wrote = true;
  const card = await daemon.call("card.dismissUnblocked", { cardId: args.id ?? "" });
  return args.json ? json(card) : said(`dismissed the unblocked mark of ${card.id}  ${card.title}`);
}

async function diffCard(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const diff = await daemon.call("card.diff", { cardId: args.id ?? "" });
  return args.json ? json(diff) : said(...diffLines(diff));
}

async function specOfCard(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const card = await daemon.call("card.spec", { cardId: args.id ?? "" });
  return args.json ? json(card) : said(...specLines(card));
}

/** The review may move the card (it can send it to Waiting) and costs the plan: a write, like the app's button. */
async function reviewCard(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  note.wrote = true;
  const review = await daemon.call("card.review", {
    cardId: args.id ?? "",
    ...(args.language ? { language: args.language } : {}),
  });
  const printed = args.json ? json(review) : said(...reviewLines(args.id ?? "", review));
  if (review.state === "done") return printed;
  // A review that failed is not a result to build on: exit 1, with what it said.
  return args.json
    ? { ...printed, code: 1 }
    : failure(1, `review of ${args.id ?? ""} failed: ${review.summary}`);
}

async function messageCard(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
): Promise<CliResult> {
  const text = textOf(args);
  note.wrote = true;
  const sent = await daemon.call("card.message", { cardId: args.id ?? "", text });
  if (args.json) return json(sent);
  return said(
    sent.queued
      ? `queued for ${args.id ?? ""}: the session is working, it reads this after its turn`
      : `sent to ${args.id ?? ""}`,
  );
}

async function templatesOf(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const { projects } = await daemon.call("project.list", {});
  const project = pick(projects, args.project);
  const found = await daemon.call("card.templates", { projectId: project.id });
  return args.json ? json(found) : said(...templatesLines(project, found));
}

async function validationOf(args: CardCliArgs, daemon: DaemonClient): Promise<CliResult> {
  const found = await daemon.call("card.validationTemplate", { cardId: args.id ?? "" });
  return args.json ? json(found) : said(...validationLines(found));
}

function perform(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CliResult> {
  switch (args.action) {
    case "move":
      return moveCard(args, daemon, note);
    case "update":
      return updateCard(args, daemon, note);
    case "stop":
      return stopCard(args, daemon, note);
    case "complete":
      return endCard(args, daemon, note, "completed");
    case "discard":
      return endCard(args, daemon, note, "discarded");
    case "delete":
      return endCard(args, daemon, note, "deleted");
    case "list":
      return listCards(args, daemon);
    case "show":
      return showCard(args, daemon);
    case "new":
      return newCard(args, daemon, note);
    case "start":
      return startCard(args, daemon, note);
    case "diff":
      return diffCard(args, daemon);
    case "spec":
      return specOfCard(args, daemon);
    case "review":
      return reviewCard(args, daemon, note);
    case "message":
      return messageCard(args, daemon, note);
    case "templates":
      return templatesOf(args, daemon);
    case "validation-template":
      return validationOf(args, daemon);
    case "pr-create":
      return prOfCard(args, daemon, note);
    case "update-from-base":
      return rebaseCard(args, daemon, note);
    case "merge-local":
      return mergeCard(args, daemon, note);
    case "arena":
      return arenaOf(args, daemon);
    case "start-arena":
      return startArena(args, daemon, note);
    case "choose-variant":
      return chooseVariant(args, daemon, note);
    case "check-loop":
      return checkLoop(args, daemon, note);
    case "dismiss-unblocked":
      return dismissUnblocked(args, daemon, note);
  }
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export function runCardCli(
  args: CardCliArgs,
  config: { bind: string; port: number; token: string },
  options: CardCliOptions = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-card",
    timeoutMs:
      options.timeoutMs ?? (args.action === "review" ? REVIEW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    perform: (daemon, note) => perform(args, daemon, note),
    unsure: UNSURE[args.action],
  });
}
