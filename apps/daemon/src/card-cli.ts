/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */
import type { Card, Project } from "@flightdeck/protocol";
import { DaemonClient, DaemonUnreachable, daemonUrl } from "./mcp.ts";

export interface CardCliArgs {
  action: "list" | "show" | "new" | "start";
  /** `--project`: an id or a name; without it, the only project of the host. */
  project?: string | undefined;
  /** `show` and `start`: the card. */
  id?: string | undefined;
  /** `new`: the title. */
  title?: string | undefined;
  description?: string | undefined;
  /** `start --workflow`. */
  workflow?: string | undefined;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean | undefined;
}

export interface CardCliResult {
  code: 0 | 1 | 2;
  out: string[];
  err: string[];
}

export interface CardCliOptions {
  /** How long the daemon has to answer before the command gives up (exit 2). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** The address of this machine only: the token of the config is never sent anywhere else. */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (name === "localhost" || name === "::1") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  return octets?.slice(1).every((octet) => Number(octet) <= 255) ?? false;
}

/** An answer to give as exit 1: nothing the daemon or the person did wrong is an exception to show. */
class Refusal extends Error {}
class TimedOut extends Error {}

const WAITS: Record<NonNullable<Card["queueReason"]>, string> = {
  slot: "waiting for a free slot",
  quota: "waiting for the plan quota to reset",
  memory: "waiting for the host's memory",
  budget: "waiting for the budget",
  paused: "the host is paused",
};

/** Why a card has not started, in words; null when nothing holds it. */
function waitOf(card: Card): string | null {
  if (card.queued) {
    const base = WAITS[card.queueReason ?? "slot"];
    return card.queueReason === "quota" && card.quotaUntil
      ? `${base} (until ${card.quotaUntil})`
      : base;
  }
  const blockers = card.waitingOn?.length ?? 0;
  return blockers > 0
    ? `waiting for ${blockers} ${blockers === 1 ? "card" : "cards"} to be done first`
    : null;
}

const names = (projects: Project[]) => projects.map((project) => project.name).join(", ");

/** The project a name or id points to; without a name, the only one the host has. */
function pick(projects: Project[], wanted: string | undefined): Project {
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

const json = (value: unknown): CardCliResult => ({
  code: 0,
  out: [JSON.stringify(value, null, 2)],
  err: [],
});
const said = (...out: string[]): CardCliResult => ({ code: 0, out, err: [] });

async function perform(args: CardCliArgs, daemon: DaemonClient): Promise<CardCliResult> {
  switch (args.action) {
    case "list": {
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
          return `${project}  ${card.id}  ${column}  ${card.title}${wait ? ` (${wait})` : ""}`;
        }),
      );
    }
    case "show": {
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
    case "new": {
      const { projects } = await daemon.call("project.list", {});
      const project = pick(projects, args.project);
      const card = await daemon.call("card.create", {
        projectId: project.id,
        title: args.title ?? "",
        description: args.description ?? "",
      });
      return args.json ? json(card) : said(`created ${card.id}  ${card.title}`);
    }
    case "start": {
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
  }
}

const failure = (code: 1 | 2, message: string): CardCliResult => ({
  code,
  out: [],
  err: [message],
});

/** The daemon of this host, with the token of its config: never from the arguments or the environment. */
export async function runCardCli(
  args: CardCliArgs,
  config: { bind: string; port: number; token: string },
  options: CardCliOptions = {},
): Promise<CardCliResult> {
  const url = daemonUrl(config);
  const host = new URL(url).hostname;
  if (!isLoopbackHost(host))
    return failure(
      1,
      `refusing to talk to ${host}: this command reaches only a daemon on the loopback (127.0.0.1 or ::1)`,
    );
  // Whatever the daemon or the network say, the token is not in it.
  const hide = (text: string) => text.split(config.token).join("[token]");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let daemon: DaemonClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    daemon = await DaemonClient.connect(url, config.token, "flightdeck-card");
    return perform(args, daemon);
  };
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), timeoutMs);
  });
  try {
    return await Promise.race([work(), clock]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DaemonUnreachable || message === "connection closed")
      return failure(2, `could not reach the daemon at ${url}: is it running?`);
    if (error instanceof TimedOut)
      return failure(2, `the daemon at ${url} did not answer in ${Math.ceil(timeoutMs / 1000)} s`);
    return failure(1, hide(message));
  } finally {
    clearTimeout(timer);
    daemon?.close();
  }
}
