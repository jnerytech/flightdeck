/**
 * Issue #3514: `flightdeckd session create` and `fork`, the verbs that start a session of the daemon,
 * as the app's new-session form and its fork button do. Exit codes: 0 done, 1 refused, 2 no daemon (or no
 * answer: a session may or may not have been started).
 */
import { type CliResult, type DaemonClient, failure, json, said } from "../daemon-client/index.ts";
import { forkLine } from "./domain/session-act-view.ts";
import type { SessionCliArgs } from "./domain/session-cli-args.ts";

export const START_UNSURE =
  "; a session may or may not have been started: check with `sessions` before trying again";

export async function performStart(
  daemon: DaemonClient,
  note: { wrote: boolean },
  args: SessionCliArgs,
): Promise<CliResult> {
  const start = args.start ?? {};
  if (start.cwd === undefined || start.cwd === "") return failure(1, "missing the folder: --cwd");
  note.wrote = true;
  if (args.action === "fork") {
    const result = await daemon.call("session.fork", {
      claudeSessionId: args.claudeSessionId ?? "",
      cwd: start.cwd,
      ...(start.upToMessageId === undefined ? {} : { upToMessageId: start.upToMessageId }),
      open: start.open ?? "flightdeck",
    });
    const from = args.claudeSessionId ?? "";
    return args.json
      ? json({
          action: "fork",
          claudeSessionId: result.claudeSessionId,
          session: result.sessionId ?? null,
          command: result.command ?? null,
        })
      : said(forkLine(from, result));
  }
  const { sessionId } = await daemon.call("session.create", {
    cwd: start.cwd,
    ...(start.prompt === undefined ? {} : { prompt: start.prompt }),
    ...(start.name === undefined ? {} : { name: start.name }),
    ...(start.model === undefined ? {} : { model: start.model }),
    ...(start.effort === undefined ? {} : { effort: start.effort }),
    ...(start.permissionMode === undefined ? {} : { permissionMode: start.permissionMode }),
    ...(start.persona === undefined
      ? {}
      : {
          persona: { id: start.persona, ...(start.language ? { language: start.language } : {}) },
        }),
  });
  return args.json
    ? json({ session: sessionId, action: "create" })
    : said(`started session ${sessionId}`);
}
