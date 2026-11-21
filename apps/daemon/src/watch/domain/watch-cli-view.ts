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
  const tail = roundTail(round);
  return `  round ${round.n} (${round.id}): ${round.status}, ${dollars(round.costUsd)}, ${round.turns} turns${tail}`;
}

/** What follows a round's counts: the files a held round changed outside its PR, else its summary. */
function roundTail(round: FixRoundInfo): string {
  const outside = round.drift?.outside.length ?? 0;
  if (round.status === "held" && outside > 0) return `, ${outside} files outside the PR`;
  return round.summary ? `: ${round.summary}` : "";
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

function watchState(info: WatchInfo): string {
  if (!info.enabled) return "watch off";
  if (info.status !== "needs_you") return "watching";
  const why = info.reason ? `: ${info.reason}` : "";
  return `needs you${why}`;
}

export function watchLines(info: WatchInfo): string[] {
  const state = watchState(info);
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
  return {
    lines: result.text.replace(/\n$/, "").split("\n"),
    notice: redactedNotice(result.redacted),
  };
}

function redactedNotice(n: number): string | null {
  if (n > 0) {
    const lines = n === 1 ? "line looked" : "lines looked";
    const verb = n === 1 ? "was" : "were";
    return `${n} ${lines} like a secret and ${verb} left out`;
  }
  return null;
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

/** A setting is a flag, a number, a name, a list of them, or nothing: never an object. */
const shown = (value: boolean | number | string | string[] | null | undefined): string => {
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
