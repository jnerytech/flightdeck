/**
 * Issue #3615: the read side of `flightdeckd snippet`: `render`, `parse` and `import-history`. None of them
 * saves, pastes or runs anything: the daemon answers from what it keeps. (`list` and `get` are
 * `runSnippetCli` in the actions domain, the mod's reader.) Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  DaemonRefusal,
  failure,
  json,
  plain,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import {
  favoriteLine,
  historyLines,
  importedLines,
  parseLines,
  renderLines,
  savedLine,
  trustedLine,
  usedLines,
} from "./domain/snippet-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const UNSURE =
  "; the host may or may not have made the change: run snippet list, and look at the terminal for use, before you run it again";
/** What `snippets.parse` takes (the protocol's limit). */
const MOST_TEXT = 1_000_000;

export interface SnippetVerbArgs {
  action: "render" | "parse" | "import-history" | "save" | "remove" | "favorite" | "trust" | "use";
  /** `render`: the snippet's name, or its id. */
  name?: string;
  projectPath?: string;
  values?: Record<string, string>;
  /** `parse`: the text to read, already taken from its file or stdin. */
  text?: string;
  limit?: number;
  reveal?: boolean;
  /** `save`: the command of a command snippet, or the text of a prompt snippet. */
  run?: string;
  prompt?: string;
  tags?: string[];
  /** `trust`: the hash of the project's file, as `snippet list` shows it. */
  hash?: string;
  /** `import-history`: the candidates to make snippets of; without it the verb only reads. */
  select?: string[];
  /** `use`: the terminal to type into, and whether to press Enter. */
  terminalId?: string;
  enter?: boolean;
  /** `favorite`: clear the mark. */
  off?: boolean;
  json?: boolean;
}

/** The text `snippet parse` reads: a file, or stdin for `-`; a failure to read says which and why not more. */
export async function readSnippetSource(
  source: string,
  stdin: ReadableStream<Uint8Array> | undefined,
): Promise<string> {
  let text: string;
  try {
    text = await (source === "-"
      ? new Response(stdin ?? Bun.stdin.stream()).text()
      : Bun.file(source).text());
  } catch {
    throw new Error(`could not read ${source === "-" ? "stdin" : source}`);
  }
  if (text.length > MOST_TEXT)
    throw new Error(
      `${source} holds ${text.length} characters: snippet parse reads at most ${MOST_TEXT} characters`,
    );
  return text;
}

/** A snippet by name (the host's, then the project's) and, when no name matches, by id. */
async function resolve(daemon: DaemonClient, name: string, projectPath: string | undefined) {
  try {
    return await daemon.call("snippets.get", { name, ...(projectPath ? { projectPath } : {}) });
  } catch (error) {
    if (!(error instanceof DaemonRefusal) || error.code !== "not_found") throw error;
    return await daemon.call("snippets.get", { id: name });
  }
}

/**
 * The snippet a write by name means. A name the host and the project both have is two snippets, and the host's
 * would win in `resolve`: a write refuses it and names the ids, so none is changed or typed by mistake.
 */
async function resolveOne(daemon: DaemonClient, name: string, projectPath: string | undefined) {
  if (projectPath) {
    const { snippets } = await daemon.call("snippets.list", { projectPath });
    const same = snippets.filter((s) => s.name === name);
    if (same.length > 1)
      throw new DaemonRefusal(
        "invalid_request",
        `${plain(name)} names ${same.length} snippets (${same.map((s) => s.id).join(", ")}): give one of the ids`,
      );
  }
  return await resolve(daemon, name, projectPath);
}

/** The verbs that change what the host keeps or runs. */
const WRITING = ["save", "remove", "favorite", "trust", "use"];

/** One write: the snippet is resolved first (a read), `note.wrote` is set right before the call that changes something. */
async function write(
  daemon: DaemonClient,
  note: { wrote: boolean },
  args: SnippetVerbArgs,
): Promise<CliResult> {
  if (args.action === "save") {
    const { name, run, prompt, tags, projectPath } = args;
    note.wrote = true;
    const saved = await daemon.call("snippets.save", {
      name: name as string,
      ...(run === undefined
        ? { type: "prompt", text: prompt as string }
        : { type: "command", run }),
      ...(tags ? { tags } : {}),
      scope: projectPath ? "project" : "host",
      target: "daemon",
      ...(projectPath ? { projectPath } : {}),
    });
    return args.json ? json(saved) : said(savedLine(saved));
  }
  if (args.action === "trust") {
    note.wrote = true;
    try {
      const info = await daemon.call("snippets.trust", {
        projectPath: args.projectPath as string,
        hash: args.hash as string,
      });
      return args.json ? json(info) : said(trustedLine(info));
    } catch (error) {
      // A host with a device enrolled wants that device's signature, which a terminal cannot give (#3647).
      if (error instanceof DaemonRefusal && error.reason === "approval_proof_required")
        return failure(
          1,
          `${args.projectPath} has a device enrolled on this host, which confirms the trust of a project's snippet file, so do it in the app`,
        );
      throw error;
    }
  }
  const snippet = await resolveOne(daemon, args.name as string, args.projectPath);
  if (args.action === "remove") {
    note.wrote = true;
    await daemon.call("snippets.remove", { id: snippet.id });
    return args.json
      ? json({ id: snippet.id, name: snippet.name, removed: true })
      : said(`removed ${snippet.name}`);
  }
  if (args.action === "favorite") {
    note.wrote = true;
    const marked = await daemon.call("snippets.favorite", { id: snippet.id, favorite: !args.off });
    return args.json ? json(marked) : said(favoriteLine(marked));
  }
  if (args.action !== "use") throw new Error(`snippet ${args.action} is not a write`);
  note.wrote = true;
  const terminalId = args.terminalId as string;
  const used = await daemon.call("snippets.use", {
    id: snippet.id,
    action: "paste",
    terminalId,
    ...(args.values ? { values: args.values } : {}),
    ...(args.enter ? { enter: true } : {}),
  });
  return args.json ? json(used) : said(...usedLines(terminalId, args.enter === true, used.text));
}

export function runSnippetVerbCli(
  args: SnippetVerbArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-snippet",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      if (WRITING.includes(args.action)) return await write(daemon, note, args);
      if (args.action === "render") {
        const snippet = await resolve(daemon, args.name as string, args.projectPath);
        const { text, fields } = await daemon.call("snippets.render", {
          id: snippet.id,
          ...(args.values ? { values: args.values } : {}),
        });
        return args.json
          ? json({ id: snippet.id, name: snippet.name, text, fields })
          : said(...renderLines(text));
      }
      if (args.action === "parse") {
        const read = await daemon.call("snippets.parse", { text: args.text as string });
        // Nothing read and a reason: the text is no list of snippets.
        const nothing = read.snippets.length === 0 && read.errors.length > 0;
        if (args.json) return { ...json(read), code: nothing ? 1 : 0 };
        const reasons = read.errors.map(plain);
        return nothing
          ? { code: 1, out: [], err: reasons }
          : { ...said(...parseLines(read.snippets)), err: reasons };
      }
      if (args.select) note.wrote = true;
      const result = await daemon.call("snippets.importHistory", {
        ...(args.limit ? { limit: args.limit } : {}),
        ...(args.reveal ? { reveal: true } : {}),
        ...(args.select ? { select: args.select } : {}),
      });
      if (args.json) return json(result);
      return said(...(args.select ? importedLines(result) : historyLines(result)));
    },
  });
}
