/**
 * Issue #3615: the read side of `flightdeckd snippet`: `render`, `parse` and `import-history`. None of them
 * saves, pastes or runs anything: the daemon answers from what it keeps. (`list` and `get` are
 * `runSnippetCli` in the actions domain, the mod's reader.) Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  type DaemonClient,
  DaemonRefusal,
  json,
  plain,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { historyLines, parseLines, renderLines } from "./domain/snippet-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
/** What `snippets.parse` takes (the protocol's limit). */
const MOST_TEXT = 1_000_000;

export interface SnippetVerbArgs {
  action: "render" | "parse" | "import-history";
  /** `render`: the snippet's name, or its id. */
  name?: string;
  projectPath?: string;
  values?: Record<string, string>;
  /** `parse`: the text to read, already taken from its file or stdin. */
  text?: string;
  limit?: number;
  reveal?: boolean;
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
    perform: async (daemon) => {
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
      const result = await daemon.call("snippets.importHistory", {
        ...(args.limit ? { limit: args.limit } : {}),
        ...(args.reveal ? { reveal: true } : {}),
      });
      return args.json ? json(result) : said(...historyLines(result));
    },
  });
}
