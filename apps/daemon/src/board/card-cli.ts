/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */
import { DaemonClient, DaemonUnreachable, daemonUrl } from "../daemon-client/index.ts";
import {
  addressRefusal,
  type CardCliArgs,
  type CardCliResult,
  failure,
  json,
  pick,
  said,
  TimedOut,
  UNSURE,
  waitOf,
} from "./domain/card-cli-view.ts";

export interface CardCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

type Note = { wrote: boolean };

async function listCards(args: CardCliArgs, daemon: DaemonClient): Promise<CardCliResult> {
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

async function showCard(args: CardCliArgs, daemon: DaemonClient): Promise<CardCliResult> {
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

async function newCard(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
): Promise<CardCliResult> {
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

async function startCard(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: Note,
): Promise<CardCliResult> {
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

function perform(args: CardCliArgs, daemon: DaemonClient, note: Note): Promise<CardCliResult> {
  switch (args.action) {
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

/** What went wrong, as an exit code and a line: a write that may have gone out says so. */
function explain(
  error: unknown,
  context: { url: string; timeoutMs: number; wrote: boolean; action: CardCliArgs["action"] },
  hide: (text: string) => string,
): CardCliResult {
  const message = error instanceof Error ? error.message : String(error);
  const unsure = context.wrote ? (UNSURE[context.action] ?? "") : "";
  if (error instanceof TimedOut) {
    const seconds = Math.ceil(context.timeoutMs / 1000);
    return failure(2, `the daemon at ${context.url} did not answer in ${seconds} s${unsure}`);
  }
  const cut = message === "connection closed";
  if (cut && context.wrote) return failure(2, `the daemon closed the connection${unsure}`);
  if (cut || error instanceof DaemonUnreachable)
    return failure(2, `could not reach the daemon at ${context.url}: is it running?`);
  return failure(1, hide(message));
}

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export async function runCardCli(
  args: CardCliArgs,
  config: { bind: string; port: number; token: string },
  options: CardCliOptions = {},
): Promise<CardCliResult> {
  const url = daemonUrl(config);
  const refused = addressRefusal(config, url);
  if (refused) return refused;
  // Whatever the daemon or the network say, the token is not in it.
  const hide = (text: string) => (config.token ? text.split(config.token).join("[token]") : text);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const giveUp = new AbortController();
  /** Whether a write was sent: only then does a cut or a silence leave its result unknown. */
  const note = { wrote: false };
  let daemon: DaemonClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    daemon = await DaemonClient.connect(url, config.token, "flightdeck-card", giveUp.signal);
    if (giveUp.signal.aborted) throw new TimedOut();
    return perform(args, daemon, note);
  };
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      giveUp.abort();
      reject(new TimedOut());
    }, timeoutMs);
  });
  try {
    const done = await Promise.race([work(), clock]);
    return { code: done.code, out: done.out.map(hide), err: done.err.map(hide) };
  } catch (error) {
    return explain(error, { url, timeoutMs, wrote: note.wrote, action: args.action }, hide);
  } finally {
    clearTimeout(timer);
    giveUp.abort();
    daemon?.close();
  }
}
