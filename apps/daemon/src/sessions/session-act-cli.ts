/**
 * Issue #3514: the verbs of `flightdeckd session` that act on one session of the daemon, as the app's
 * buttons do: interrupt, close, resume, sleep, set-model, set-effort and meta set. The session is its
 * id or its name. Exit codes: 0 done, 1 refused, 2 no daemon (or no answer: the change may or may not
 * have gone in).
 */
import { type EffortLevel, SettableMode } from "@flightdeck/protocol";
import {
  type CliResult,
  type DaemonClient,
  failure,
  json,
  resolveSession,
  said,
} from "../daemon-client/index.ts";
import {
  doneLine,
  effortLine,
  metaLine,
  modeLine,
  modelLine,
  personaLeftLine,
  personaTakenLine,
  sleepLine,
  sleepRefusal,
} from "./domain/session-act-view.ts";
import type { SessionCliArgs } from "./domain/session-cli-args.ts";

export const ACT_UNSURE =
  "; the change may or may not have gone into the session: look at the session before you do it again";

/** `default` gives the model's own back: the daemon takes null for it. */
const orDefault = (value: string | undefined): string | null =>
  value === undefined || value === "default" ? null : value;

export async function performAct(
  daemon: DaemonClient,
  note: { wrote: boolean },
  args: SessionCliArgs,
): Promise<CliResult> {
  const { sessions } = await daemon.call("session.list", {});
  const ref = resolveSession(sessions, args.session ?? "");
  if ("refusal" in ref) return ref.refusal;
  const sessionId = ref.id;
  const out = (line: string, value: Record<string, unknown> = {}): CliResult =>
    args.json ? json({ session: sessionId, action: args.action, ...value }) : said(line);
  if (args.action === "meta-set") {
    const claudeSessionId = sessions.find((s) => s.id === sessionId)?.claudeSessionId;
    if (!claudeSessionId) return failure(1, `${args.session} has no Claude session yet`);
    note.wrote = true;
    const meta = await daemon.call("session.meta.set", { claudeSessionId, ...args.meta });
    return out(metaLine(sessionId, Object.keys(args.meta ?? {}), meta), {
      claudeSessionId,
      name: meta.name,
      pinned: meta.pinned,
      archived: meta.archived,
    });
  }
  note.wrote = true;
  switch (args.action) {
    case "set-model": {
      const model = orDefault(args.value);
      await daemon.call("session.setModel", { sessionId, model });
      return out(modelLine(sessionId, model), { model });
    }
    case "set-effort": {
      const effort = orDefault(args.value) as EffortLevel | null;
      await daemon.call("session.setEffort", { sessionId, effort });
      return out(effortLine(sessionId, effort), { effort });
    }
    case "set-mode": {
      const mode = SettableMode.safeParse(args.value);
      if (!mode.success)
        return failure(1, `${args.value} is not a mode a live session can be set to`);
      await daemon.call("session.setMode", { sessionId, permissionMode: mode.data });
      return out(modeLine(sessionId, mode.data), { permissionMode: mode.data });
    }
    case "apply-persona": {
      const language = args.start?.language;
      const persona = { id: args.value ?? "", ...(language ? { language } : {}) };
      const result = await daemon.call("session.applyPersona", { sessionId, persona });
      return out(personaTakenLine(sessionId, result.persona, result.delivery), {
        persona: result.persona,
        text: result.text,
        delivery: result.delivery ?? null,
      });
    }
    case "clear-persona": {
      const language = args.start?.language;
      const result = await daemon.call("session.clearPersona", {
        sessionId,
        ...(language ? { language } : {}),
      });
      return out(personaLeftLine(sessionId, result.persona, result.delivery), {
        persona: result.persona,
        text: result.text,
        delivery: result.delivery ?? null,
      });
    }
    case "sleep": {
      const { result } = await daemon.call("session.sleep", { sessionId });
      const refusal = sleepRefusal(sessionId, result);
      return refusal ? failure(1, refusal) : out(sleepLine(sessionId, result), { result });
    }
    case "interrupt":
    case "close":
    case "resume":
      await daemon.call(`session.${args.action}`, { sessionId });
      return out(doneLine(sessionId, args.action));
    default:
      return failure(1, `${args.action} is not a verb that acts on a session`);
  }
}
