/**
 * Issue #1507: `flightdeckd card list|show|new|start`, the board from a terminal, a git alias, a cron
 * job or a CI step. It speaks to the local daemon like the MCP server does (the same `DaemonClient`,
 * the token of the config), and the daemon applies the same rules as for the app: the queue, the
 * holds and the limits. Exit codes: 0 done (a start that must wait says why), 1 refused, 2 no daemon.
 */
import { type Card, type Project, WS_PATH } from "@flightdeck/protocol";
import { DaemonClient, DaemonUnreachable, daemonUrl } from "../daemon-client/index.ts";

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

const WAITS: Record<string, string> = {
  slot: "waiting for a free slot",
  quota: "waiting for the plan quota to reset",
  memory: "waiting for the host's memory",
  budget: "waiting for the budget",
  paused: "the host is paused",
};

/** Why a card has not started, in words; null when nothing holds it. */
function waitOf(card: Card): string | null {
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

/** A card's text comes from the board, an issue or the daemon: it may not drive the terminal or reorder what it reads. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
const plain = (text: string) => text.replace(CONTROL, " ");

const json = (value: unknown): CardCliResult => ({
  code: 0,
  // JSON leaves DEL and the C1 characters raw; its own line breaks are the only ones kept.
  out: [
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((line) => plain(line))
      .join("\n"),
  ],
  err: [],
});
const said = (...out: string[]): CardCliResult => ({ code: 0, out: out.map(plain), err: [] });

async function perform(
  args: CardCliArgs,
  daemon: DaemonClient,
  note: { wrote: boolean },
): Promise<CardCliResult> {
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
          const tail = wait === null ? "" : ` (${wait})`;
          return `${project}  ${card.id}  ${column}  ${card.title}${tail}`;
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
      note.wrote = true;
      const card = await daemon.call("card.create", {
        projectId: project.id,
        title: args.title ?? "",
        description: args.description ?? "",
      });
      return args.json ? json(card) : said(`created ${card.id}  ${card.title}`);
    }
    case "start": {
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
  }
}

const failure = (code: 1 | 2, message: string): CardCliResult => ({
  code,
  out: [],
  err: [plain(message)],
});

/** What a write that got no answer may have done. */
const UNSURE: Partial<Record<CardCliArgs["action"], string>> = {
  new: "; the card may or may not have been created: check with `card list` before trying again",
  start: "; the card may or may not have been started: check with `card show` before trying again",
};

/** Why this command will not talk to the address of the config, or null when it is the local daemon. */
function addressRefusal(config: { bind: string; port: number }, url: string): CardCliResult | null {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return failure(1, `${config.bind} is not a valid address for the daemon`);
  }
  // The address, and nothing else the bind could smuggle into the URL (a user, a query, another path).
  const portOk = target.port === String(config.port) || (config.port === 80 && target.port === "");
  const plain =
    portOk &&
    target.pathname === WS_PATH &&
    target.username === "" &&
    target.search === "" &&
    target.hash === "";
  if (isLoopbackHost(target.hostname) && plain) return null;
  return failure(
    1,
    `refusing to talk to ${target.hostname}: this command reaches only a daemon on the loopback (127.0.0.1 or ::1)`,
  );
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
