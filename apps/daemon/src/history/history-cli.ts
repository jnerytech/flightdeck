/**
 * Issue #3461: `flightdeckd history list|search|get|tool|resume|watch`, the recorded conversations from a
 * terminal or a script. It speaks to the local daemon like `flightdeckd card` does (the same
 * `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. `resume` is
 * the one write (no answer is "unsure"); `watch` is a stream (docs/decisions/2026-11-20-cli-streams.md).
 */
import {
  type CliResult,
  DaemonRefusal,
  failure,
  json,
  runOnLocalDaemon,
  said,
  streamFrames,
} from "../daemon-client/index.ts";
import {
  changeJson,
  type HistoryCliArgs,
  hitLine,
  messageLines,
  summaryLine,
  toolLines,
  UNSURE,
  watchLine,
} from "./domain/history-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

/** The filters the person typed and nothing else: the daemon has its own defaults. */
function given<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export async function runHistoryCli(
  args: HistoryCliArgs,
  config: { bind: string; port: number; token: string },
  options: {
    timeoutMs?: number;
    /** `watch` stops when this aborts (Ctrl-C). */
    signal?: AbortSignal;
    /** `watch` writes each line here as it comes. */
    write?: (line: string) => void;
  } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-history",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Only a resume can leave its result unknown; a read has nothing to say.
    unsure: args.action === "resume" ? UNSURE : "",
    perform: async (daemon, note, flow) => {
      if (args.action === "list") {
        const { cwd, projectKey, from, to, origin, hideAutomated, limit, cursor } = args;
        const list = await daemon.call(
          "history.list",
          given({ cwd, projectKey, from, to, origin, hideAutomated, limit, cursor }),
        );
        if (args.json) return json(list);
        const more = list.nextCursor ? [`more: history list --cursor ${list.nextCursor}`] : [];
        return said(...list.sessions.map(summaryLine), ...more);
      }
      if (args.action === "search") {
        const { query = "", cwd, from, to, limit } = args;
        const found = await daemon.call("history.search", {
          query,
          ...given({ cwd, from, to, limit }),
        });
        if (args.json) return json(found);
        return said(...(found.hits.length ? found.hits.map(hitLine) : ["no session matches"]));
      }
      if (args.action === "get") {
        const { claudeSessionId = "", cursor, tail, limit } = args;
        const page = await daemon.call("history.get", {
          claudeSessionId,
          ...given({ cursor, tail, limit }),
        });
        if (args.json) return json(page);
        const next = page.nextCursor
          ? [`more: history get ${claudeSessionId} --cursor ${page.nextCursor}`]
          : [];
        const earlier = page.prevCursor
          ? [`earlier: history get ${claudeSessionId} --cursor ${page.prevCursor}`]
          : [];
        return said(...page.messages.flatMap(messageLines), ...earlier, ...next);
      }
      if (args.action === "watch")
        return streamFrames({
          daemon,
          flow,
          signal: options.signal ?? new AbortController().signal,
          write: options.write ?? (() => undefined),
          open: () => daemon.call("history.watch", {}),
          type: "history.changed",
          line: (change) => (args.json ? changeJson(change) : watchLine(change)),
        });
      if (args.action === "resume") {
        const { claudeSessionId = "", name, permissionMode, force } = args;
        note.wrote = true;
        try {
          const created = await daemon.call("history.resume", {
            claudeSessionId,
            ...given({ name, permissionMode, force }),
          });
          return args.json ? json(created) : said(`resumed as session ${created.sessionId}`);
        } catch (error) {
          // The daemon words this for the protocol (`force: true`); a terminal types `--force`.
          if (error instanceof DaemonRefusal && error.reason === "session_maybe_active")
            return failure(
              1,
              "session possibly in use elsewhere; add --force to resume anyway",
              error.reason,
            );
          throw error;
        }
      }
      const { claudeSessionId = "", uuid = "", index = 0 } = args;
      const found = await daemon.call("history.tool", { claudeSessionId, uuid, index });
      if (!found.tool)
        return failure(1, "no tool call at that place in the transcript", "not_found");
      return args.json ? json(found) : said(...toolLines(found.tool));
    },
  });
}
