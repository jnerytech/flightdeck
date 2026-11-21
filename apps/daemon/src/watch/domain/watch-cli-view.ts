/**
 * Issue #3539: what `flightdeckd watch` prints, as pure rules over the
 * daemon's answers. A `--json` value keeps every key: `null` where an older daemon sends none.
 */
import type {
  CardTraceInfo,
  FixRoundInfo,
  UrlTraceInfo,
  WatchInfo,
  WatchSettings,
} from "@flightdeck/protocol";

/** What a write that got no answer may have done, as text that follows the message. */
export const UNSURE =
  "; the change may or may not have been made: check with `watch get` or `watch settings` before trying again";

export const resolvedLine = (resolution: "push" | "drop", round: string) =>
  `${resolution === "push" ? "pushed" : "dropped"} round ${round}`;

const dollars = (usd: number) => `$${usd.toFixed(2)}`;

/** One fixing round; the id is what a later `watch resolve-held` takes. */
function roundLine(round: FixRoundInfo): string {
  const outside = round.drift?.outside.length ?? 0;
  const tail =
    round.status === "held" && outside > 0
      ? `, ${outside} files outside the PR`
      : round.summary
        ? `: ${round.summary}`
        : "";
  return `  round ${round.n} (${round.id}): ${round.status}, ${dollars(round.costUsd)}, ${round.turns} turns${tail}`;
}

/** The watch as the protocol returns it, with the fields an older daemon leaves out as `null`. */
export function watchJson(info: WatchInfo) {
  return {
    ...info,
    reason: info.reason ?? null,
    roundsUsed: info.roundsUsed ?? null,
    maxRounds: info.maxRounds ?? null,
    rounds: withDrift(info.rounds),
  };
}

const withDrift = (rounds: FixRoundInfo[]) =>
  rounds.map((round) => ({ ...round, drift: round.drift ?? null }));

/** The trace with each round's `drift` as `null` when an older daemon leaves it out, as `watchJson` does. */
export function traceJson(trace: CardTraceInfo) {
  return { ...trace, rounds: withDrift(trace.rounds) };
}

export function byUrlJson(found: UrlTraceInfo) {
  return { ...found, trace: found.trace ? traceJson(found.trace) : null };
}

export function watchLines(info: WatchInfo): string[] {
  const state = !info.enabled
    ? "watch off"
    : info.status === "needs_you"
      ? `needs you${info.reason ? `: ${info.reason}` : ""}`
      : "watching";
  const used =
    info.roundsUsed !== undefined && info.maxRounds !== undefined
      ? `, ${info.roundsUsed} of ${info.maxRounds} rounds used`
      : "";
  return [`${info.cardId}: ${state}${used}`, ...info.rounds.map(roundLine)];
}

export function traceLines(trace: CardTraceInfo): string[] {
  const lines = [
    `${trace.title} (${trace.cardId})`,
    `PR: ${trace.prUrl ?? "none"}`,
    `work item: ${trace.workItem ?? "none"}`,
    `cost: ${trace.costUsd === null ? "unknown" : dollars(trace.costUsd)}`,
  ];
  if (trace.sessions.length > 0) {
    lines.push("sessions:");
    for (const s of trace.sessions) {
      const cost = s.costUsd === null ? "unknown" : dollars(s.costUsd);
      lines.push(
        `  ${s.sessionId}  ${s.kind}  ${s.startedAt}  ${cost}  ${s.checkpoints} checkpoints  ${s.name ?? ""}`.trimEnd(),
      );
    }
  }
  if (trace.rounds.length > 0) lines.push("rounds:", ...trace.rounds.map(roundLine));
  return lines;
}

export function byUrlLines(found: UrlTraceInfo): string[] {
  if (found.via === "card") return ["via: card", ...(found.trace ? traceLines(found.trace) : [])];
  if (found.via === "history") {
    return [
      "via: history",
      ...found.sessions.map((s) => `  ${s.claudeSessionId}  ${s.title ?? "(no title)"}  ${s.cwd}`),
    ];
  }
  return ["via: none: no card and no session in the history mentions it"];
}

/** The description as lines (the printer flattens a line break), and what the daemon left out as a secret, for stderr. */
export function describeParts(result: { text: string; redacted: number }): {
  lines: string[];
  notice: string | null;
} {
  const n = result.redacted;
  return {
    lines: result.text.replace(/\n$/, "").split("\n"),
    notice:
      n > 0
        ? `${n} ${n === 1 ? "line looked" : "lines looked"} like a secret and ${n === 1 ? "was" : "were"} left out`
        : null,
  };
}

/** The settings as the protocol returns them, with the fields an older daemon leaves out as `null`. */
export function settingsJson(settings: WatchSettings) {
  return {
    ...settings,
    checkRounds: settings.checkRounds ?? null,
    checkEnv: settings.checkEnv ?? null,
    checkLoopDefault: settings.checkLoopDefault ?? null,
    driftAllow: settings.driftAllow ?? null,
  };
}

const shown = (value: unknown): string => {
  if (value === undefined) return "unknown";
  if (value === null) return "none";
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  return String(value);
};

/** One line a setting, named as the flag of the write side will name it. */
export function settingsLines(project: string, settings: WatchSettings): string[] {
  return [
    `${project}: PR watch settings`,
    `enabled: ${shown(settings.enabled)}`,
    `max-rounds: ${shown(settings.maxRounds)}`,
    `checks: ${shown(settings.checks)}`,
    `check-timeout-min: ${shown(settings.checkTimeoutMin)}`,
    `budget-usd: ${shown(settings.budgetUsd)}`,
    `max-turns: ${shown(settings.maxTurns)}`,
    `persona: ${shown(settings.persona)}`,
    `max-failures: ${shown(settings.maxFailures)}`,
    `daily-usd: ${shown(settings.dailyUsd)}`,
    `check-rounds: ${shown(settings.checkRounds)}`,
    `check-env: ${shown(settings.checkEnv)}`,
    `check-loop-default: ${shown(settings.checkLoopDefault)}`,
    `drift-allow: ${shown(settings.driftAllow)}`,
  ];
}
