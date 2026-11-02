import { describe, expect, test } from "bun:test";
import { projectLabels } from "../src/lib/costs.ts";

const labels = (...keys: string[]) => keys.map((key) => projectLabels(keys).get(key));

describe("costs: the label of each project", () => {
  test("labels that are already unique stay as they are", () => {
    expect(labels("kA", "host:alfa:/w/docs-site", "host:beta:C:\\x\\api")).toEqual([
      "kA",
      "docs-site",
      "api",
    ]);
    expect(labels()).toEqual([]);
  });

  test("the same folder name on two hosts is told apart by the host", () => {
    expect(labels("host:alfa:/w/docs-site", "host:beta:/w/docs-site")).toEqual([
      "docs-site · alfa",
      "docs-site · beta",
    ]);
  });

  test("the same folder name on one host is told apart by the parent folder, on either separator", () => {
    expect(labels("host:alfa:/a/docs-site", "host:alfa:/b/docs-site")).toEqual([
      "a/docs-site",
      "b/docs-site",
    ]);
    expect(labels("host:alfa:C:\\x\\app", "host:alfa:C:\\y\\app")).toEqual(["x/app", "y/app"]);
  });

  test("the host and the parent folder are both shown when neither tells them apart alone", () => {
    expect(labels("host:alfa:/a/d", "host:alfa:/b/d", "host:beta:/a/d")).toEqual([
      "a/d · alfa",
      "b/d · alfa",
      "a/d · beta",
    ]);
  });

  test("a key without a host or folder keeps its label; the others are told apart around it", () => {
    expect(labels("docs-site", "host:alfa:/w/docs-site")).toEqual([
      "docs-site",
      "docs-site · alfa",
    ]);
  });

  test("a folder with no parent, and a clash nothing tells apart, fall back to what they have", () => {
    expect(labels("host:alfa:/app", "host:alfa:/x/app")).toEqual(["app", "x/app"]);
    expect(labels("host:alfa:/app", "host:alfa:app")).toEqual(["host:alfa:/app", "host:alfa:app"]);
  });
});
