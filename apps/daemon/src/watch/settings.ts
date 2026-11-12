import type { Database } from "bun:sqlite";
import { isCheckEnvName } from "@flightdeck/protocol";
import { z } from "zod";
import { parseJsonOr } from "../kernel/index.ts";

export interface WatchSettings {
  enabled: boolean;
  /** Rounds of fixing per PR. */
  maxRounds: number;
  /** Commands that must pass in the card's worktree before anything is pushed. */
  checks: string[];
  /** Minutes each local check gets before it is killed. */
  checkTimeoutMin: number;
  /** Estimated cost of the rounds of a PR, in US$; `null` for no limit. */
  budgetUsd: number | null;
  /** Turns of the rounds of a PR; `null` for no limit. */
  maxTurns: number | null;
  /** The persona the fixing session runs in. */
  persona: string;
  /** Rounds in a row that fail before the card asks for you. */
  maxFailures: number;
  /** Estimated cost of every fixing round of the project in a day, in US$; `null` for no limit. */
  dailyUsd: number | null;
  /** Issue #77: globs of files a round may change outside its PR; they never count as drift. */
  driftAllow: string[];
  /** Issue #1361: rounds of the check loop per turn of the person. */
  checkRounds: number;
  /** Issue #1361: names added to the checks' allowlisted environment. */
  checkEnv: string[];
  /** Issue #1361: new cards in bypassPermissions start with the check loop on. */
  checkLoopDefault: boolean;
}

const DEFAULT_SETTINGS: WatchSettings = {
  enabled: false,
  maxRounds: 3,
  checks: [],
  checkTimeoutMin: 10,
  budgetUsd: 5,
  maxTurns: 30,
  persona: "revisor",
  maxFailures: 2,
  dailyUsd: 20,
  checkRounds: 3,
  checkEnv: [],
  checkLoopDefault: false,
  driftAllow: [
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "*.snap",
  ],
};

/**
 * A project's watch settings, read from the database alone, so what reads them needs no watcher
 * made first (#1361: the board reads them for a looping card while it starts).
 */
export function readWatchSettings(db: Database, projectId: string): WatchSettings {
  const row = db
    .query<{ settings: string }, [string]>(
      "SELECT settings FROM pr_watch_project WHERE project_id = ?",
    )
    .get(projectId);
  const kept = row ? parseJsonOr(z.record(z.string(), z.unknown()), row.settings, {}) : {};
  const stored: WatchSettings = { ...DEFAULT_SETTINGS, ...kept };
  // Issue #1361: a list stored before the rules (or by hand) keeps only the names they allow.
  const names: unknown[] = Array.isArray(stored.checkEnv) ? stored.checkEnv : [];
  // A cap stored by hand or by an older daemon is read inside the range the protocol allows.
  const rounds = Number.isInteger(stored.checkRounds)
    ? stored.checkRounds
    : DEFAULT_SETTINGS.checkRounds;
  return {
    ...stored,
    checkRounds: Math.min(10, Math.max(1, rounds)),
    checkEnv: names.filter(
      (name): name is string => typeof name === "string" && isCheckEnvName(name),
    ),
  };
}
