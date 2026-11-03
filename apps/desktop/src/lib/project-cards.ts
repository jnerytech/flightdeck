import type { Card, CostsSummary, Project } from "@flightdeck/protocol";
import type { HubRow } from "./hub.ts";

/** One project as a card of the Projects screen. */
export interface ProjectCard {
  hostId: string;
  hostName: string;
  projectId: string;
  name: string;
  path: string;
  branch: string;
  projectKey: string;
  liveSessions: number;
  inProgress: number;
  needsYou: number;
  /** The latest activity of a session or card of the project, `null` when there is none. */
  lastActivity: string | null;
  /** The project's cost over the week, `null` while the host has not answered. */
  costWeekUsd: number | null;
}

export interface ProjectCardsInput {
  hosts: Array<{ id: string; name: string; projects: Project[] }>;
  keyOf(hostId: string, project: Project): string;
  rows: HubRow[];
  cards: Array<{ hostId: string; card: Card }>;
  /** The last seven days of each host, by host id. */
  costs: Record<string, CostsSummary | undefined>;
}

export type ProjectSort = "activity" | "name" | "cost" | "attention";

const LIVE = new Set(["running", "needs_you"]);

/** One card per project of every host, from what the app already holds. */
export function buildProjectCards(input: ProjectCardsInput): ProjectCard[] {
  return input.hosts.flatMap((host) =>
    host.projects.map((project): ProjectCard => {
      const projectKey = input.keyOf(host.id, project);
      const rows = input.rows.filter((r) => r.hostId === host.id && r.projectKey === projectKey);
      const cards = input.cards.filter(
        (c) => c.hostId === host.id && c.card.projectId === project.id,
      );
      const moments = [...rows.map((r) => r.lastActivity), ...cards.map((c) => c.card.updatedAt)];
      const summary = input.costs[host.id];
      return {
        hostId: host.id,
        hostName: host.name,
        projectId: project.id,
        name: project.name,
        path: project.path,
        branch: project.baseBranch,
        projectKey,
        liveSessions: rows.filter((r) => LIVE.has(r.state)).length,
        inProgress: cards.filter((c) => c.card.column === "in_progress").length,
        needsYou: rows.filter((r) => r.state === "needs_you").length,
        lastActivity: moments.reduce<string | null>(
          (latest, at) => (latest === null || at > latest ? at : latest),
          null,
        ),
        costWeekUsd: summary
          ? (summary.byProject.find((p) => p.projectKey === projectKey)?.costUsd ?? 0)
          : null,
      };
    }),
  );
}

/** Folds case and accents so "Sao" finds "São". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The cards whose name, host, branch or path holds the query. */
export function filterProjectCards(cards: ProjectCard[], query: string): ProjectCard[] {
  const needle = fold(query.trim());
  if (needle === "") return cards;
  return cards.filter((c) =>
    [c.name, c.hostName, c.branch, c.path].some((field) => fold(field).includes(needle)),
  );
}

const byName = (a: ProjectCard, b: ProjectCard) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** A sorted copy; ties fall back to the name. */
export function sortProjectCards(cards: ProjectCard[], sort: ProjectSort): ProjectCard[] {
  const copy = [...cards];
  switch (sort) {
    case "name":
      return copy.sort(byName);
    case "activity":
      return copy.sort(
        (a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || byName(a, b),
      );
    case "cost":
      return copy.sort((a, b) => (b.costWeekUsd ?? -1) - (a.costWeekUsd ?? -1) || byName(a, b));
    case "attention":
      return copy.sort(
        (a, b) =>
          b.needsYou - a.needsYou ||
          b.inProgress + b.liveSessions - (a.inProgress + a.liveSessions) ||
          byName(a, b),
      );
  }
}
