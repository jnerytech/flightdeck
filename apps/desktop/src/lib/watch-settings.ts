import { isCheckEnvName, isWatchCheck, type WatchSettings } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/** The watch settings of a project as the form holds them: text, so a field can be half typed. */
export interface WatchDraft {
  enabled: boolean;
  maxRounds: string;
  /** Empty: no limit. */
  budgetUsd: string;
  /** Empty: no limit. */
  dailyUsd: string;
  /** One command per line. */
  checks: string;
  /** Minutes each check gets. */
  checkTimeoutMin: string;
  /** Issue #1361: the check loop's settings; absent from a host from before it. */
  loop: { checkRounds: string; checkEnv: string; checkLoopDefault: boolean } | null;
}

export function watchDraftOf(settings: WatchSettings | null): WatchDraft {
  return {
    enabled: settings?.enabled ?? false,
    maxRounds: settings ? String(settings.maxRounds) : "",
    budgetUsd: settings?.budgetUsd == null ? "" : String(settings.budgetUsd),
    dailyUsd: settings?.dailyUsd == null ? "" : String(settings.dailyUsd),
    checks: settings?.checks.join("\n") ?? "",
    checkTimeoutMin: settings ? String(settings.checkTimeoutMin) : "",
    loop:
      settings?.checkRounds === undefined
        ? null
        : {
            checkRounds: String(settings.checkRounds),
            checkEnv: (settings.checkEnv ?? []).join("\n"),
            checkLoopDefault: settings.checkLoopDefault ?? false,
          },
  };
}

const limit = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** The variable names of the checks: the non-blank lines, each once. */
const envNames = (text: string): string[] => [...new Set(checkLines(text))];

/** The non-blank lines of the checks: one command with its arguments each. */
const checkLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * What the host takes: whole rounds from 1 to 10, a limit that is empty or above zero, and checks
 * that are a command and its arguments.
 */
export function validateWatchDraft(draft: WatchDraft, t: T): string | null {
  const rounds = Number(draft.maxRounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
    return t("watchSettingsUi.badRounds");
  }
  const minutes = Number(draft.checkTimeoutMin);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    return t("watchSettingsUi.badTimeout");
  }
  for (const [text, label] of [
    [draft.budgetUsd, t("watchSettingsUi.budget")],
    [draft.dailyUsd, t("watchSettingsUi.daily")],
  ] as const) {
    const value = limit(text);
    if (value !== null && (Number.isNaN(value) || value <= 0))
      return t("watchSettingsUi.badLimit", { label });
  }
  if (!checkLines(draft.checks).every(isWatchCheck)) return t("watchSettingsUi.badCheck");
  const loop = loopProblemsOf(draft, t);
  if (loop.checkRounds !== null || loop.checkEnv !== null) return t("watchSettingsUi.fixMarked");
  return null;
}

/** What is wrong with each check loop field, shown under that field (#1498); `null`: nothing. */
export interface LoopProblems {
  checkRounds: string | null;
  checkEnv: string | null;
}

export function loopProblemsOf(draft: WatchDraft, t: T): LoopProblems {
  if (!draft.loop) return { checkRounds: null, checkEnv: null };
  const rounds = Number(draft.loop.checkRounds);
  const roundsOk = Number.isInteger(rounds) && rounds >= 1 && rounds <= 10;
  return {
    checkRounds: roundsOk ? null : t("watchSettingsUi.badCheckRounds"),
    checkEnv: checkEnvProblem(draft.loop.checkEnv, t),
  };
}

/**
 * The first thing wrong with the variable names, said by the name alone: a `NAME=value` line gets
 * the name to keep, since the host reads the value from its own environment. The value is never
 * shown: a pasted secret must not end up on the screen or read aloud.
 */
function checkEnvProblem(text: string, t: T): string | null {
  const names = envNames(text);
  // The host's own limits (the protocol's `checkEnv`): at most 20 names of up to 64 characters.
  if (names.length > 20 || names.some((name) => name.length > 64)) {
    return t("watchSettingsUi.tooManyCheckEnv");
  }
  for (const line of names) {
    if (isCheckEnvName(line)) continue;
    const name = line.split("=")[0]?.trim() ?? "";
    if (line.includes("=") && isCheckEnvName(name)) {
      return t("watchSettingsUi.envNameOnly", { name });
    }
    return t("watchSettingsUi.badCheckEnv", { name });
  }
  return null;
}

/**
 * The patch the host takes: the empty limit is `null`, the checks and the variables are the
 * non-blank lines. Only what differs from `saved` goes (#1361): a far host refuses a change to
 * what runs unattended, so a field the person did not touch is never sent.
 */
export function watchPatchOf(draft: WatchDraft, saved: WatchSettings): Partial<WatchSettings> {
  const next: Partial<WatchSettings> = {
    enabled: draft.enabled,
    maxRounds: Number(draft.maxRounds),
    budgetUsd: limit(draft.budgetUsd),
    dailyUsd: limit(draft.dailyUsd),
    checks: checkLines(draft.checks),
    checkTimeoutMin: Number(draft.checkTimeoutMin),
    ...(draft.loop
      ? {
          checkRounds: Number(draft.loop.checkRounds),
          checkEnv: envNames(draft.loop.checkEnv),
          checkLoopDefault: draft.loop.checkLoopDefault,
        }
      : {}),
  };
  const changed = Object.entries(next).filter(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof WatchSettings]),
  );
  return Object.fromEntries(changed) as Partial<WatchSettings>;
}
