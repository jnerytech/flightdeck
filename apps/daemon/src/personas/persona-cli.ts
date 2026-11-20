/**
 * Issue #3456: `flightdeckd persona list|show|subagents`, the personas from a terminal or a script.
 * It speaks to the local daemon like `flightdeckd card` does (the same `DaemonClient`, the token of
 * the config). These verbs only read. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { resolve } from "node:path";
import { type CliResult, json, runOnLocalDaemon, said } from "../daemon-client/index.ts";
import {
  listLines,
  type PersonaCliArgs,
  showLines,
  subagentsLines,
} from "./domain/persona-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export function runPersonaCli(
  args: PersonaCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number } = {},
): Promise<CliResult> {
  // A relative folder means the one the person is in, which the daemon cannot see.
  const projectPath = args.projectPath === undefined ? undefined : resolve(args.projectPath);
  const where = projectPath === undefined ? {} : { projectPath };
  const language = args.language === undefined ? {} : { language: args.language };
  return runOnLocalDaemon({
    config,
    clientName: "flightdeck-persona",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      switch (args.action) {
        case "list": {
          const answer = await daemon.call("personas.list", {
            ...(args.scope === undefined ? {} : { scope: args.scope }),
            ...where,
            ...language,
          });
          return args.json ? json(answer) : said(...listLines(answer));
        }
        case "show": {
          const answer = await daemon.call("personas.resolve", {
            ref: { id: args.id ?? "", ...language },
            ...where,
          });
          return args.json ? json(answer) : said(...showLines(answer));
        }
        case "subagents": {
          const answer = await daemon.call("personas.subagents", { ...where, ...language });
          return args.json ? json(answer) : said(...subagentsLines(answer));
        }
        case "save":
        case "remove":
        case "reset":
        case "publish-agent":
          return said();
      }
    },
  });
}
