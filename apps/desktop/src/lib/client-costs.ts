import type { CostsFilter, CostsSummary } from "@flightdeck/protocol";
import { ALL_CLIENTS, type ClientScope } from "./client-scope.ts";
import { type ClientColor, UNASSIGNED } from "./clients.ts";

/** The summary of nothing, for a period. */
export function emptySummary(from: string, to: string): CostsSummary {
  return {
    from,
    to,
    totals: {
      costUsd: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      cacheSavingsUsd: 0,
      messages: 0,
      unpricedMessages: 0,
    },
    byDay: [],
    byProject: [],
    byModel: [],
    byOrigin: [],
    byPersona: [],
    topSessions: [],
  };
}

export interface HostSummary {
  hostId: string;
  summary: CostsSummary;
}

const TOP_SESSIONS = 20;

/** Adds `cost` and `tokens` of an item into the entry of `key`. */
function add<K>(
  map: Map<K, { costUsd: number; tokens: number }>,
  key: K,
  cost: number,
  tokens: number,
) {
  const entry = map.get(key) ?? { costUsd: 0, tokens: 0 };
  map.set(key, { costUsd: entry.costUsd + cost, tokens: entry.tokens + tokens });
}

const byCost = (a: { costUsd: number }, b: { costUsd: number }) => b.costUsd - a.costUsd;

/** The summaries of several hosts as one, and which host each of the top sessions ran on. */
export function mergeSummaries(
  entries: HostSummary[],
  from: string,
  to: string,
): { summary: CostsSummary; sessionHost: Record<string, string> } {
  const merged = emptySummary(from, to);
  const days = new Map<string, { costUsd: number; tokens: number }>();
  const projects = new Map<string, { costUsd: number; tokens: number }>();
  const origins = new Map<string, { costUsd: number; tokens: number }>();
  const personas = new Map<string | null, { costUsd: number; tokens: number }>();
  const models = new Map<string, { costUsd: number; tokens: number; priced: boolean }>();
  const sessions: Array<CostsSummary["topSessions"][number] & { hostId: string }> = [];
  for (const { hostId, summary } of entries) {
    const { totals } = summary;
    merged.totals.costUsd += totals.costUsd;
    merged.totals.cacheSavingsUsd += totals.cacheSavingsUsd;
    merged.totals.messages += totals.messages;
    merged.totals.unpricedMessages += totals.unpricedMessages;
    for (const field of ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"] as const) {
      merged.totals.tokens[field] += totals.tokens[field];
    }
    for (const d of summary.byDay) add(days, `${d.day}\t${d.projectKey}`, d.costUsd, d.tokens);
    for (const p of summary.byProject) add(projects, p.projectKey, p.costUsd, p.tokens);
    for (const o of summary.byOrigin) add(origins, o.origin, o.costUsd, o.tokens);
    for (const p of summary.byPersona) add(personas, p.persona, p.costUsd, p.tokens);
    for (const m of summary.byModel) {
      const seen = models.get(m.model);
      models.set(m.model, {
        costUsd: (seen?.costUsd ?? 0) + m.costUsd,
        tokens: (seen?.tokens ?? 0) + m.tokens,
        priced: (seen?.priced ?? true) && m.priced,
      });
    }
    for (const s of summary.topSessions) sessions.push({ ...s, hostId });
  }
  merged.byDay = [...days]
    .map(([key, v]) => {
      const [day = "", projectKey = ""] = key.split("\t");
      return { day, projectKey, ...v };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.projectKey.localeCompare(b.projectKey));
  merged.byProject = [...projects]
    .map(([projectKey, v]) => ({ projectKey, ...v }))
    .sort((a, b) => byCost(a, b) || a.projectKey.localeCompare(b.projectKey));
  merged.byModel = [...models].map(([model, v]) => ({ model, ...v })).sort(byCost);
  merged.byOrigin = [...origins]
    .map(([origin, v]) => ({ origin: origin as CostsSummary["byOrigin"][number]["origin"], ...v }))
    .sort(byCost);
  merged.byPersona = [...personas].map(([persona, v]) => ({ persona, ...v })).sort(byCost);
  const top = sessions.sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_SESSIONS);
  merged.topSessions = top.map(({ hostId: _host, ...session }) => session);
  return {
    summary: merged,
    sessionHost: Object.fromEntries(top.map((s) => [s.claudeSessionId, s.hostId])),
  };
}

export interface ClientCostRow {
  clientId: string;
  name: string;
  color: ClientColor | null;
  costUsd: number;
  tokens: number;
}

/** What each client spent in a summary, the most first, with what no client claims as its own row. */
export function costByClient(
  summary: CostsSummary,
  scope: ClientScope,
  names: { id: string; name: string; color: ClientColor }[],
  unassignedName: string,
): ClientCostRow[] {
  const spent = new Map<string, { costUsd: number; tokens: number }>();
  for (const p of summary.byProject) add(spent, scope.clientOf(p.projectKey), p.costUsd, p.tokens);
  const rows: ClientCostRow[] = [
    ...names.map((c) => ({ clientId: c.id, name: c.name, color: c.color as ClientColor | null })),
    { clientId: UNASSIGNED, name: unassignedName, color: null },
  ].map((row) => ({ ...row, ...(spent.get(row.clientId) ?? { costUsd: 0, tokens: 0 }) }));
  return rows
    .filter((row) => row.costUsd > 0 || row.tokens > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

export interface LoadedCosts {
  summary: CostsSummary;
  sessionHost: Record<string, string>;
  /** The hosts that did not answer. */
  failed: string[];
}

/**
 * The costs of `hostIds` as one summary. With a client selected, only its projects count: each
 * host is asked for its projects first, then for each project of the client, so every breakdown
 * stays exact. A host that does not answer is left out and listed.
 */
export async function loadCostsSummary(args: {
  hostIds: string[];
  filter: CostsFilter;
  selection: string;
  scope: ClientScope;
  ask(hostId: string, filter: CostsFilter): Promise<CostsSummary | null>;
}): Promise<LoadedCosts> {
  const { hostIds, filter, selection, scope, ask } = args;
  const { from, to } = filter;
  if (selection === ALL_CLIENTS) {
    const answers = await Promise.all(
      hostIds.map(async (hostId) => [hostId, await ask(hostId, filter)] as const),
    );
    return finish(answers, from, to);
  }
  const { projectKey: chosen, ...wide } = filter;
  const bases = await Promise.all(
    hostIds.map(async (hostId) => [hostId, await ask(hostId, wide)] as const),
  );
  const perProject = await Promise.all(
    bases.flatMap(([hostId, base]) =>
      (base?.byProject ?? [])
        .map((p) => p.projectKey)
        .filter((key) => scope.includes(selection, key) && (chosen === undefined || key === chosen))
        .map(async (key) => [hostId, await ask(hostId, { ...wide, projectKey: key })] as const),
    ),
  );
  const failed = bases.filter(([, base]) => base === null).map(([hostId]) => hostId);
  const merged = finish(perProject, from, to);
  return { ...merged, failed };
}

/** The answers merged; a null answer is a host that failed. */
function finish(
  answers: ReadonlyArray<readonly [string, CostsSummary | null]>,
  from: string,
  to: string,
): LoadedCosts {
  const entries = answers.flatMap(([hostId, summary]) => (summary ? [{ hostId, summary }] : []));
  const failed = answers.filter(([, summary]) => summary === null).map(([hostId]) => hostId);
  return { ...mergeSummaries(entries, from, to), failed };
}
