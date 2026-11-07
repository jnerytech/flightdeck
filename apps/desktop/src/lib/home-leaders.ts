import type { CostsSummary } from "@flightdeck/protocol";

/** The part of a costs summary the leaderboard reads: tokens by project, model and persona. */
export type LeaderSource = Pick<CostsSummary, "byProject" | "byModel" | "byPersona">;

export interface Trend {
  /** `new`: nothing in the first half (its tokens are in the second, or only today). */
  direction: "up" | "down" | "flat" | "new";
  /** The change between the halves, in whole percent; `null` for `new`. */
  percent: number | null;
}

export interface LeaderRow {
  /** The project key, model or persona; `null` is no persona. */
  key: string | null;
  /** 0 for one item; above 0, the row stands for that many items past the top ones. */
  others: number;
  tokens: number;
  /** Of every token of the period, 0 to 1. */
  share: number;
  trend: Trend;
}

export interface HomeLeaders {
  project: LeaderRow[];
  model: LeaderRow[];
  persona: LeaderRow[];
}

/** How many items each list names before the rest row. */
const TOP = 5;
/** A change under this share of the first half is flat. */
const FLAT = 0.1;

type Key = string | null;
type Tokens = Map<Key, number>;

/** Tokens by item of one dimension, the same item of several hosts added up. */
function tokensOf(rows: Array<{ key: Key; tokens: number }>): Tokens {
  const sums: Tokens = new Map();
  for (const { key, tokens } of rows) sums.set(key, (sums.get(key) ?? 0) + tokens);
  return sums;
}

const sumOf = (sums: Tokens, keys: Key[]) => keys.reduce((n, key) => n + (sums.get(key) ?? 0), 0);

function trend(first: number, second: number): Trend {
  // A listed item has tokens: none in days 1-3 means it is new, in days 4-6 or only today.
  if (first === 0) return { direction: "new", percent: null };
  const change = (second - first) / first;
  const percent = Math.round(Math.abs(change) * 100);
  if (Math.abs(change) < FLAT) return { direction: "flat", percent };
  return { direction: change > 0 ? "up" : "down", percent };
}

/** One dimension's rows: the top items by tokens, then one row for the rest. */
function leaders(week: Tokens, first: Tokens, second: Tokens): LeaderRow[] {
  const total = sumOf(week, [...week.keys()]);
  const items = [...week]
    .filter(([, tokens]) => tokens > 0)
    .sort(([a, x], [b, y]) => y - x || String(a ?? "").localeCompare(String(b ?? "")));
  const row = (key: Key, keys: Key[]): LeaderRow => {
    const tokens = sumOf(week, keys);
    return {
      key,
      others: keys.length > 1 ? keys.length : 0,
      tokens,
      share: tokens / total,
      trend: trend(sumOf(first, keys), sumOf(second, keys)),
    };
  };
  // A rest row stands for two or more: one more item is named instead.
  const named = items.length > TOP + 1 ? items.slice(0, TOP) : items;
  const rest = items.slice(named.length).map(([key]) => key);
  return [...named.map(([key]) => row(key, [key])), ...(rest.length ? [row(null, rest)] : [])];
}

/**
 * The share of tokens over the 7 days by project, model and persona (`week`), each with the trend
 * from days 1-3 (`first`) to days 4-6 (`second`): today is not over, so it is in no half.
 */
export function homeLeaders(
  week: LeaderSource,
  first: LeaderSource,
  second: LeaderSource,
): HomeLeaders {
  const project = (s: LeaderSource) =>
    tokensOf(s.byProject.map((r) => ({ key: r.projectKey, tokens: r.tokens })));
  const model = (s: LeaderSource) =>
    tokensOf(s.byModel.map((r) => ({ key: r.model, tokens: r.tokens })));
  const persona = (s: LeaderSource) =>
    tokensOf(s.byPersona.map((r) => ({ key: r.persona, tokens: r.tokens })));
  return {
    project: leaders(project(week), project(first), project(second)),
    model: leaders(model(week), model(first), model(second)),
    persona: leaders(persona(week), persona(first), persona(second)),
  };
}

/** The share in whole percent; `null` for a share above 0 that rounds to 0 ("under 1%"). */
export function sharePercent(share: number): number | null {
  const percent = Math.round(share * 100);
  return percent === 0 && share > 0 ? null : percent;
}
