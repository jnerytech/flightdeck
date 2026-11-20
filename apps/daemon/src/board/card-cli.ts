/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  json,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  type CardCliArgs,
  columnOf,
  confirmed,
  pick,
  UNSURE,
  updateOf,
  waitOf,
} from "./domain/card-cli-view.ts";

export interface CardCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

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
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: (daemon, note) => perform(args, daemon, note),
    unsure: UNSURE[args.action],
  });
}
