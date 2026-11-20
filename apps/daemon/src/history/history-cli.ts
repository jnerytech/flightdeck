/**
 * Issue #3461: `flightdeckd history list|search|get|tool`, the recorded conversations from a
 * terminal or a script. It speaks to the local daemon like `flightdeckd card` does (the same
 * `DaemonClient`, the token of the config). Exit codes: 0 done, 1 refused, 2 no daemon. Every verb
 * here only reads, so no answer is never "unsure".
 */
import { type CliResult, failure, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import {
  type HistoryCliArgs,
  hitLine,
  messageLines,
  summaryLine,
  toolLines,
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
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-history",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: "",
    perform: async (daemon) => {
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
      const { claudeSessionId = "", uuid = "", index = 0 } = args;
      const found = await daemon.call("history.tool", { claudeSessionId, uuid, index });
      if (!found.tool)
        return failure(1, "no tool call at that place in the transcript", "not_found");
      return args.json ? json(found) : said(...toolLines(found.tool));
    },
  });
}
