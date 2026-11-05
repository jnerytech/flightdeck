/**
 * Phase 36: the ROI roll-up. Per project key, for a period and for the same-length period before
 * it: the cost the agents ran up, what was delivered (cards and PRs, planned and unplanned), the
 * rework, the estimated hours and the approvals' waits. Facts only: no rate, price or value.
 */
import type { Database } from "bun:sqlite";
import type { RoiPeriod, RoiSignalValues, RoiSummaryResult, RoiWeek } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import type { RoiSignals } from "./signals.ts";

const MAX_DAYS = 366;

/** A calendar day that really exists (not 2026-02-31). */
const isDay = (day: string): boolean => {
  const at = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === day;
};

/** The filter of a request, refused with a reason when the period is not one: backwards, over a year, or not a date. */
export function roiPeriod(payload: RoiFilter): RoiFilter {
  const length = isDay(payload.from) && isDay(payload.to) ? lengthOf(payload.from, payload.to) : 0;
  if (length < 1 || length > MAX_DAYS) {
    throw new FlightdeckError(
      "bad_request",
      "the period must be a real range of days, at most a year",
      "roi_period_invalid",
    );
  }
  return payload;
}

export interface RoiFilter {
  /** First and last day, YYYY-MM-DD, both included. */
  from: string;
  to: string;
  projectKey?: string;
}

export interface RoiSummarizerOptions {
  db: Database;
  /** The project key of a folder; the folder itself when absent. */
  keyOf?: (path: string) => string;
  /** Where the optional signals come from; without it a project's switches change nothing. */
  signals?: Pick<RoiSignals, "agentCommits" | "issuesClosed">;
}

const DAY_MS = 86_400_000;
const WEEKS = 8;

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const lengthOf = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

interface DoneJoin {
  via: string;
  done_at: string;
  card_created_at: string;
  fix_rounds: number;
  fix_cost_usd: number;
  approx: number;
  issue_ref: string | null;
  estimate_hours: number | null;
  default_hours: number | null;
}

interface Totals {
  costUsd: number;
  tokens: number;
  cards: number;
  planned: number;
  unplanned: number;
  prsMerged: number;
  plannedPrs: number;
  unplannedPrs: number;
}

export class RoiSummarizer {
  constructor(private readonly opts: RoiSummarizerOptions) {}

  private keyOf(path: string): string {
    return this.opts.keyOf?.(path) ?? path;
  }

  /** `summary` plus, for the projects that switched them on, the optional signals of the period. */
  async summaryWithSignals(filter: RoiFilter): Promise<RoiSummaryResult> {
    const result = this.summary(filter);
    const { signals } = this.opts;
    if (!signals) return result;
    const folders = this.opts.db
      .query<{ path: string; roi_commits: number; roi_issues: number }, []>(
        "SELECT path, roi_commits, roi_issues FROM projects WHERE roi_commits = 1 OR roi_issues = 1",
      )
      .all();
    const projects = await Promise.all(
      result.projects.map(async (project) => {
        const mine = folders.filter((f) => this.keyOf(f.path) === project.projectKey);
        if (mine.length === 0) return project;
        const values: RoiSignalValues = {};
        const commits = mine.filter((f) => f.roi_commits === 1);
        if (commits.length > 0) {
          const counts = await Promise.all(
            commits.map((f) => signals.agentCommits(f.path, filter.from, filter.to)),
          );
          values.agentCommits = counts.reduce((sum, n) => sum + n, 0);
        }
        const issues = mine.filter((f) => f.roi_issues === 1);
        if (issues.length > 0) {
          const answers = await Promise.all(
            issues.map((f) => signals.issuesClosed(f.path, filter.from, filter.to)),
          );
          const failed = answers.find((a) => "error" in a);
          if (failed && "error" in failed) values.issuesError = failed.error;
          else {
            values.issuesClosed = answers.reduce((sum, a) => sum + ("count" in a ? a.count : 0), 0);
          }
        }
        return { ...project, signals: values };
      }),
    );
    return { ...result, projects };
  }

  summary(filter: RoiFilter): RoiSummaryResult {
    const { db } = this.opts;
    const length = lengthOf(filter.from, filter.to);
    const previousTo = addDays(filter.from, -1);
    const previousFrom = addDays(previousTo, -(length - 1));
    // The project ids behind each key (two folders of one repository share a key), and the keys
    // that only the usage knows (a session outside every project of the board).
    const projects = db
      .query<{ id: string; path: string; name: string }, []>("SELECT id, path, name FROM projects")
      .all();
    const byKey = new Map<string, { name: string; ids: string[] }>();
    for (const project of projects) {
      const key = this.keyOf(project.path);
      const known = byKey.get(key) ?? { name: project.name, ids: [] };
      known.ids.push(project.id);
      byKey.set(key, known);
    }
    for (const row of db
      .query<{ project_key: string }, []>("SELECT DISTINCT project_key FROM usage_entries")
      .all()) {
      if (row.project_key && !byKey.has(row.project_key)) {
        byKey.set(row.project_key, { name: row.project_key, ids: [] });
      }
    }
    const keys = [...byKey.keys()]
      .filter((key) => filter.projectKey === undefined || key === filter.projectKey)
      .sort((a, b) => a.localeCompare(b, "en"));
    return {
      from: filter.from,
      to: filter.to,
      previousFrom,
      previousTo,
      projects: keys.map((key) => {
        const entry = byKey.get(key) as { name: string; ids: string[] };
        return {
          projectKey: key,
          name: entry.name,
          current: this.period(key, entry.ids, filter.from, filter.to),
          previous: this.period(key, entry.ids, previousFrom, previousTo),
        };
      }),
    };
  }

  /** The cost, the tokens and the delivered counts of a window of days. */
  private totals(key: string, ids: string[], from: string, to: string): Totals {
    const { db } = this.opts;
    const usage = db
      .query<{ cost: number | null; tokens: number | null }, [string, string, string]>(
        `SELECT SUM(cost_usd) AS cost,
                SUM(COALESCE(input,0) + COALESCE(output,0) + COALESCE(cache_read,0)
                    + COALESCE(cache_write_5m,0) + COALESCE(cache_write_1h,0)) AS tokens
         FROM usage_entries WHERE project_key = ? AND day BETWEEN ? AND ?`,
      )
      .get(key, from, to);
    const totals: Totals = {
      costUsd: usage?.cost ?? 0,
      tokens: usage?.tokens ?? 0,
      cards: 0,
      planned: 0,
      unplanned: 0,
      prsMerged: 0,
      plannedPrs: 0,
      unplannedPrs: 0,
    };
    for (const row of this.doneRows(ids, from, to)) {
      const planned = row.card_created_at.slice(0, 10) < from;
      totals.cards += 1;
      totals[planned ? "planned" : "unplanned"] += 1;
      if (row.via === "merged") {
        totals.prsMerged += 1;
        totals[planned ? "plannedPrs" : "unplannedPrs"] += 1;
      }
    }
    return totals;
  }

  private doneRows(ids: string[], from: string, to: string): DoneJoin[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => "?").join(",");
    return this.opts.db
      .query<DoneJoin, string[]>(
        `SELECT d.via, d.done_at, d.card_created_at, d.fix_rounds, d.fix_cost_usd, d.approx,
                c.issue_ref, c.estimate_hours, p.default_hours
         FROM card_done d JOIN cards c ON c.id = d.card_id JOIN projects p ON p.id = d.project_id
         WHERE d.project_id IN (${marks}) AND substr(d.done_at, 1, 10) BETWEEN ? AND ?`,
      )
      .all(...ids, from, to);
  }

  private period(key: string, ids: string[], from: string, to: string): RoiPeriod {
    const { db } = this.opts;
    const base = this.totals(key, ids, from, to);
    const done = this.doneRows(ids, from, to);
    let hours = 0;
    let cardsWithoutEstimate = 0;
    for (const row of done) {
      const value = row.estimate_hours ?? row.default_hours;
      if (value === null) cardsWithoutEstimate += 1;
      else hours += value;
    }
    const waits = db
      .query<{ created_at: string; resolved_at: string; cwd: string }, [string, string]>(
        `SELECT r.created_at, r.resolved_at, s.cwd FROM permission_requests r
         JOIN sessions s ON s.id = r.session_id
         WHERE r.resolved_at IS NOT NULL AND substr(r.resolved_at, 1, 10) BETWEEN ? AND ?`,
      )
      .all(from, to)
      .filter((row) => this.keyOf(row.cwd) === key);
    const waitedSeconds = waits.reduce(
      (sum, row) =>
        sum + Math.max(0, (Date.parse(row.resolved_at) - Date.parse(row.created_at)) / 1000),
      0,
    );
    const outside = db
      .query<{ cost: number | null }, [string, string, string]>(
        `SELECT SUM(cost_usd) AS cost FROM usage_entries
         WHERE project_key = ? AND day BETWEEN ? AND ?
           AND (claude_session_id IS NULL OR claude_session_id NOT IN
                (SELECT s.claude_session_id FROM card_runs r JOIN sessions s ON s.id = r.session_id
                 WHERE s.claude_session_id IS NOT NULL))`,
      )
      .get(key, from, to);
    const weeks: RoiWeek[] = [];
    for (let k = WEEKS - 1; k >= 0; k -= 1) {
      const weekTo = addDays(to, -7 * k);
      const weekFrom = addDays(weekTo, -6);
      const week = this.totals(key, ids, weekFrom, weekTo);
      weeks.push({
        from: weekFrom,
        to: weekTo,
        costUsd: week.costUsd,
        tokens: week.tokens,
        cards: week.cards,
        planned: week.planned,
        unplanned: week.unplanned,
        prsMerged: week.prsMerged,
      });
    }
    return {
      ...base,
      issuesResolved: done.filter((row) => row.issue_ref !== null).length,
      fixRounds: done.reduce((sum, row) => sum + row.fix_rounds, 0),
      fixCostUsd: done.reduce((sum, row) => sum + row.fix_cost_usd, 0),
      hours,
      cardsWithoutEstimate,
      decisions: waits.length,
      waitedSeconds,
      outsideCardsUsd: outside?.cost ?? 0,
      approxCards: done.filter((row) => row.approx === 1).length,
      weeks,
    };
  }
}
