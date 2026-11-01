import { isWatchCheck, type WatchSettings } from "@flightdeck/protocol";
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
}

export function watchDraftOf(settings: WatchSettings | null): WatchDraft {
  return {
    enabled: settings?.enabled ?? false,
    maxRounds: settings ? String(settings.maxRounds) : "",
    budgetUsd: settings?.budgetUsd == null ? "" : String(settings.budgetUsd),
    dailyUsd: settings?.dailyUsd == null ? "" : String(settings.dailyUsd),
    checks: settings?.checks.join("\n") ?? "",
  };
}

const limit = (text: string): number | null => (text.trim() === "" ? null : Number(text));

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
  for (const [text, label] of [
    [draft.budgetUsd, t("watchSettingsUi.budget")],
    [draft.dailyUsd, t("watchSettingsUi.daily")],
  ] as const) {
    const value = limit(text);
    if (value !== null && !(value > 0)) return t("watchSettingsUi.badLimit", { label });
  }
  if (!checkLines(draft.checks).every(isWatchCheck)) return t("watchSettingsUi.badCheck");
  return null;
}

/** The patch the host takes: the empty limit is `null`, the checks are the non-blank lines. */
export function watchPatchOf(draft: WatchDraft): Partial<WatchSettings> {
  return {
    enabled: draft.enabled,
    maxRounds: Number(draft.maxRounds),
    budgetUsd: limit(draft.budgetUsd),
    dailyUsd: limit(draft.dailyUsd),
    checks: checkLines(draft.checks),
  };
}
