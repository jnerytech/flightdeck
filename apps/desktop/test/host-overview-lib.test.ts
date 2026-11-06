import { describe, expect, test } from "bun:test";
import { hostProjectCards, hostSessionRows } from "../src/lib/host-overview.ts";
import type { HubRow } from "../src/lib/hub.ts";
import type { ProjectCard } from "../src/lib/project-cards.ts";

const row = (key: string, hostId: string, extra: Partial<HubRow> = {}): HubRow => ({
  key,
  hostId,
  hostName: hostId,
  origin: "flightdeck",
  claudeSessionId: key,
  sessionId: key,
  title: key,
  cwd: "/w",
  projectKey: "p",
  state: "idle",
  controllable: true,
  lastActivity: "2026-11-01T10:00:00.000Z",
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...extra,
});

const card = (projectId: string, hostId: string): ProjectCard => ({
  hostId,
  hostName: hostId,
  projectId,
  name: projectId,
  path: `/w/${projectId}`,
  branch: "main",
  projectKey: projectId,
  liveSessions: 0,
  inProgress: 0,
  needsYou: 0,
  lastActivity: null,
  costWeekUsd: null,
});

describe("host-overview", () => {
  test("only the host's sessions, the ones that need you first, then pinned, then the latest", () => {
    const rows = [
      row("old", "a", { lastActivity: "2026-10-01T10:00:00.000Z" }),
      row("other", "b", { state: "needs_you" }),
      row("new", "a", { lastActivity: "2026-11-02T10:00:00.000Z" }),
      row("pinned", "a", { pinned: true, lastActivity: "2026-09-01T10:00:00.000Z" }),
      row("ask", "a", { state: "needs_you", lastActivity: "2026-08-01T10:00:00.000Z" }),
    ];
    expect(hostSessionRows(rows, "a").map((r) => r.key)).toEqual(["ask", "pinned", "new", "old"]);
  });

  test("archived sessions stay out, and the list is capped", () => {
    const rows = [
      row("gone", "a", { archived: true }),
      ...Array.from({ length: 9 }, (_, i) => row(`s${i}`, "a")),
    ];
    const shown = hostSessionRows(rows, "a", 6);
    expect(shown).toHaveLength(6);
    expect(shown.map((r) => r.key)).not.toContain("gone");
  });

  test("only the host's projects, capped", () => {
    const cards = [card("p1", "a"), card("q1", "b"), card("p2", "a"), card("p3", "a")];
    expect(hostProjectCards(cards, "a").map((c) => c.projectId)).toEqual(["p1", "p2", "p3"]);
    expect(hostProjectCards(cards, "a", 2).map((c) => c.projectId)).toEqual(["p1", "p2"]);
    expect(hostProjectCards(cards, "none")).toEqual([]);
  });
});
