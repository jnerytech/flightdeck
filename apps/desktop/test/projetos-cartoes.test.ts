import { describe, expect, test } from "bun:test";
import type { Card, CostsSummary, Project } from "@flightdeck/protocol";
import { emptySummary } from "../src/lib/client-costs.ts";
import type { HubRow } from "../src/lib/hub.ts";
import {
  buildProjectCards,
  filterProjectCards,
  type ProjectCard,
  sortProjectCards,
} from "../src/lib/project-cards.ts";

const project = (id: string, name: string, baseBranch = "main"): Project =>
  ({ id, name, path: `/work/${name}`, baseBranch }) as Project;

const row = (over: Partial<HubRow>): HubRow =>
  ({
    hostId: "h1",
    projectKey: "k-api",
    state: "idle",
    lastActivity: "2026-11-01T10:00:00Z",
    ...over,
  }) as HubRow;

const card = (over: Partial<Card>): Card =>
  ({ projectId: "p-api", column: "backlog", updatedAt: "2026-10-30T10:00:00Z", ...over }) as Card;

const costs = (byProject: Array<[string, number]>): CostsSummary => ({
  ...emptySummary("2026-10-28", "2026-11-03"),
  byProject: byProject.map(([projectKey, costUsd]) => ({ projectKey, costUsd, tokens: 1 })),
});

const input = (over: Partial<Parameters<typeof buildProjectCards>[0]> = {}) => ({
  hosts: [
    {
      id: "h1",
      name: "alfa",
      projects: [project("p-api", "api", "develop"), project("p-web", "web")],
    },
    { id: "h2", name: "beta", projects: [project("p-api", "api")] },
  ],
  keyOf: (hostId: string, p: Project) => `k-${p.name}${hostId === "h2" ? "-beta" : ""}`,
  rows: [],
  cards: [],
  costs: {},
  ...over,
});

describe("projetos-cartoes: one card per project", () => {
  test("every project of every host is a card with its host, branch and key", () => {
    const cards = buildProjectCards(input());
    expect(cards.map((c) => [c.hostName, c.name, c.branch, c.projectKey])).toEqual([
      ["alfa", "api", "develop", "k-api"],
      ["alfa", "web", "main", "k-web"],
      ["beta", "api", "main", "k-api-beta"],
    ]);
  });

  test("live sessions are the running and needs-you rows of that project on that host", () => {
    const cards = buildProjectCards(
      input({
        rows: [
          row({ state: "running" }),
          row({ state: "needs_you" }),
          row({ state: "idle" }),
          row({ state: "ended" }),
          row({ state: "running", hostId: "h2", projectKey: "k-api" }),
          row({ state: "running", projectKey: "k-web" }),
        ],
      }),
    );
    expect(cards.map((c) => c.liveSessions)).toEqual([2, 1, 0]);
    expect(cards.map((c) => c.needsYou)).toEqual([1, 0, 0]);
  });

  test("cards in progress are counted by project id on the same host only", () => {
    const cards = buildProjectCards(
      input({
        cards: [
          card({ column: "in_progress" }),
          card({ column: "in_progress" }),
          card({ column: "review" }),
          card({ column: "in_progress", projectId: "p-web" }),
          card({ column: "in_progress", projectId: "p-api" }),
        ].map((c, i) => ({ hostId: i === 4 ? "h2" : "h1", card: { ...c, id: `c${i}` } as Card })),
      }),
    );
    expect(cards.map((c) => c.inProgress)).toEqual([2, 1, 1]);
  });

  test("last activity is the latest of the rows and the cards, null when none", () => {
    const cards = buildProjectCards(
      input({
        rows: [row({ lastActivity: "2026-11-01T10:00:00Z" })],
        cards: [{ hostId: "h1", card: card({ updatedAt: "2026-11-02T08:00:00Z" }) }],
      }),
    );
    expect(cards.map((c) => c.lastActivity)).toEqual(["2026-11-02T08:00:00Z", null, null]);
  });

  test("the week's cost comes from the host's summary by project key, null without a summary", () => {
    const cards = buildProjectCards(input({ costs: { h1: costs([["k-api", 4.25]]) } }));
    expect(cards.map((c) => c.costWeekUsd)).toEqual([4.25, 0, null]);
  });
});

const sample: ProjectCard[] = [
  {
    name: "web",
    hostName: "alfa",
    branch: "main",
    path: "/w/web",
    needsYou: 0,
    inProgress: 3,
    liveSessions: 0,
    lastActivity: "2026-11-01T00:00:00Z",
    costWeekUsd: 1,
  },
  {
    name: "api",
    hostName: "beta",
    branch: "develop",
    path: "/w/api",
    needsYou: 2,
    inProgress: 0,
    liveSessions: 1,
    lastActivity: "2026-11-02T00:00:00Z",
    costWeekUsd: 9,
  },
  {
    name: "docs",
    hostName: "alfa",
    branch: "main",
    path: "/w/docs",
    needsYou: 0,
    inProgress: 0,
    liveSessions: 0,
    lastActivity: null,
    costWeekUsd: null,
  },
].map((c) => ({ hostId: "h", projectId: c.name, projectKey: c.name, ...c }));

describe("projetos-cartoes: search and sort", () => {
  test("search matches name, host, branch and path, ignoring case and accents", () => {
    expect(filterProjectCards(sample, "API").map((c) => c.name)).toEqual(["api"]);
    expect(filterProjectCards(sample, "alfa").map((c) => c.name)).toEqual(["web", "docs"]);
    expect(filterProjectCards(sample, "develop").map((c) => c.name)).toEqual(["api"]);
    expect(filterProjectCards(sample, "/w/do").map((c) => c.name)).toEqual(["docs"]);
    expect(filterProjectCards(sample, "  ").map((c) => c.name)).toEqual(["web", "api", "docs"]);
  });

  test("sort by activity puts the newest first and the never-active last", () => {
    expect(sortProjectCards(sample, "activity").map((c) => c.name)).toEqual(["api", "web", "docs"]);
  });

  test("sort by name is alphabetical", () => {
    expect(sortProjectCards(sample, "name").map((c) => c.name)).toEqual(["api", "docs", "web"]);
  });

  test("sort by cost puts the dearest first and the unknown last", () => {
    expect(sortProjectCards(sample, "cost").map((c) => c.name)).toEqual(["api", "web", "docs"]);
  });

  test("sort by attention puts the ones that need you first, then the busiest", () => {
    expect(sortProjectCards(sample, "attention").map((c) => c.name)).toEqual([
      "api",
      "web",
      "docs",
    ]);
  });

  test("sorting leaves the input untouched", () => {
    const names = sample.map((c) => c.name);
    sortProjectCards(sample, "name");
    expect(sample.map((c) => c.name)).toEqual(names);
  });
});
