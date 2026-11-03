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

export function buildProjectCards(_input: ProjectCardsInput): ProjectCard[] {
  return [];
}

export function filterProjectCards(cards: ProjectCard[], _query: string): ProjectCard[] {
  return cards;
}

export function sortProjectCards(cards: ProjectCard[], _sort: ProjectSort): ProjectCard[] {
  return cards;
}
