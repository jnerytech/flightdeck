/**
 * Issue #3738: `flightdeckd template list|start` and `task results|preview`, the task templates of simple mode and
 * what a task made, from a shell. Exit codes: 0 done, 1 refused, 2 no daemon.
 */
import { posix, win32 } from "node:path";
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveSession,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import {
  CUT_SHORT_PREVIEW,
  CUT_SHORT_RESULTS,
  previewLines,
  resultLines,
  startedLine,
  templateLines,
  UNSURE_START,
} from "./domain/templates-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

export type TemplatesCliArgs = { json?: boolean } & (
  | { action: "list" }
  | {
      action: "start";
      templateId: string;
      language: "en" | "pt-BR";
      values: Record<string, string>;
      name?: string;
    }
  | { action: "results"; session: string }
  | { action: "preview"; session: string; path: string }
);

export async function runTemplatesCli(
  args: TemplatesCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-templates",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.action === "start" ? { unsure: UNSURE_START } : {}),
    perform: async (daemon, note) => {
      if (args.action === "list") {
        const result = await daemon.call("template.list", {});
        return shown(args.json, result, templateLines);
      }
      if (args.action === "start") {
        const { templates } = await daemon.call("template.list", {});
        const fields = templates.find((template) => template.id === args.templateId)?.fields ?? [];
        const relative = fields.find(
          (field) =>
            (field.kind === "folder" || field.kind === "file") &&
            args.values[field.id] !== undefined &&
            !isAbsolute(args.values[field.id] as string),
        );
        if (relative) return failure(1, `--field ${relative.id}: give an absolute path`);
        note.wrote = true;
        const started = await daemon.call("template.start", {
          templateId: args.templateId,
          language: args.language,
          values: args.values,
          ...(args.name === undefined ? {} : { name: args.name }),
        });
        return shown(args.json, started, (value) => [startedLine(value)]);
      }
      const { sessions } = await daemon.call("session.list", {});
      const ref = resolveSession(sessions, args.session);
      if ("refusal" in ref) return ref.refusal;
      if (args.action === "results") {
        const result = await daemon.call("task.results", { sessionId: ref.id });
        return withCutShort(
          shown(args.json, result, resultLines),
          result.truncated,
          CUT_SHORT_RESULTS,
        );
      }
      const preview = await daemon.call("task.preview", { sessionId: ref.id, path: args.path });
      return withCutShort(
        args.json ? shown(true, preview, () => []) : said(...previewLines(preview)),
        preview.truncated,
        CUT_SHORT_PREVIEW,
      );
    },
  });
}

/** A list or a text cut short says so on stderr, so stdout stays what a script reads. */
const withCutShort = (result: CliResult, truncated: boolean, note: string): CliResult =>
  truncated ? { ...result, err: [...result.err, note] } : result;

/** The daemon resolves a path against its own folder, not the shell's, so a path is given whole. */
const isAbsolute = (path: string): boolean => posix.isAbsolute(path) || win32.isAbsolute(path);
