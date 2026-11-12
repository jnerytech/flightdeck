import { describe, expect, test } from "bun:test";
import {
  costsHosts,
  hostsOffering,
  labelledKeys,
  periodProjectKeys,
  withFilter,
} from "../../src/features/costs/costs-derive.ts";

const host = (id: string, status: string, features?: string[]) => ({
  id,
  status,
  hostInfo: features ? { features } : null,
});
const byProject = (...keys: string[]) =>
  ({ byProject: keys.map((projectKey) => ({ projectKey })) }) as never;

describe("costsHosts", () => {
  test("only the online hosts that report costs", () => {
    const hosts = [
      host("a", "online", ["costs"]),
      host("b", "offline", ["costs"]),
      host("c", "online", ["roi"]),
      host("d", "online"),
    ];
    expect(costsHosts(hosts).map((h) => h.id)).toEqual(["a"]);
  });
});

describe("hostsOffering", () => {
  const hosts = [
    host("a", "online", ["roi", "personas"]),
    host("b", "online", ["roi"]),
    host("c", "online"),
  ];

  test("of the hosts in view, the ones that offer the feature", () => {
    expect(hostsOffering(hosts, ["a", "b", "c"], "roi").map((h) => h.id)).toEqual(["a", "b"]);
    expect(hostsOffering(hosts, ["a", "b"], "personas").map((h) => h.id)).toEqual(["a"]);
  });

  test("a host out of view is left out even when it offers the feature", () => {
    expect(hostsOffering(hosts, ["b"], "roi").map((h) => h.id)).toEqual(["b"]);
    expect(hostsOffering(hosts, [], "roi")).toEqual([]);
  });
});

describe("periodProjectKeys", () => {
  test("the period's projects, each once, with the chosen one kept even when the period lacks it", () => {
    expect(periodProjectKeys(byProject("p1", "p2"), "p3")).toEqual(["p1", "p2", "p3"]);
    expect(periodProjectKeys(byProject("p1", "p2"), "p2")).toEqual(["p1", "p2"]);
  });

  test("nothing loaded, only the chosen project; nothing chosen, only the period's", () => {
    expect(periodProjectKeys(null, "p3")).toEqual(["p3"]);
    expect(periodProjectKeys(byProject("p1"), null)).toEqual(["p1"]);
    expect(periodProjectKeys(null, null)).toEqual([]);
  });
});

describe("labelledKeys", () => {
  test("the period's, the summary's and the top sessions' projects and the chosen one, each once", () => {
    const summary = {
      ...byProject("p2", "p3"),
      topSessions: [{ projectKey: "p3" }, { projectKey: "p4" }],
    } as never;
    expect(labelledKeys({ all: byProject("p1", "p2"), summary }, "p5")).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);
  });

  test("nothing loaded and nothing chosen, no keys", () => {
    expect(labelledKeys({ all: null, summary: null }, null)).toEqual([]);
  });
});

describe("withFilter", () => {
  test("a value sets the filter and leaves the others", () => {
    expect(
      withFilter({ model: "opus" } as { model?: string; origin?: string }, "origin", "app"),
    ).toEqual({
      model: "opus",
      origin: "app",
    });
  });

  test("an empty value drops the filter, and the input is not changed", () => {
    const filters: { model?: string; origin?: string } = { model: "opus", origin: "app" };
    expect(withFilter(filters, "origin", "")).toEqual({ model: "opus" });
    expect(filters).toEqual({ model: "opus", origin: "app" });
  });
});
