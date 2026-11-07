import { describe, expect, test } from "bun:test";
import { projectLabel, projectLabels, projectPath } from "../src/lib/costs.ts";

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

// A folder project has no remote, so its key is the folder itself, as the daemon wrote it.
describe("costs: the label of a folder's own key", () => {
  test("a path key reads as its last folder, with no trailing slash, on either separator", () => {
    expect(projectLabel("/tmp/fd-demo-bet8r3/alfa/")).toBe("alfa");
    expect(projectLabel("/w/app")).toBe("app");
    expect(projectLabel("C:\\work\\app\\")).toBe("app");
    expect(projectLabel("\\\\srv\\share\\app")).toBe("app");
    expect(projectLabel("host:alfa:/w/app/")).toBe("app");
    expect(projectLabel("host:alfa:C:\\x\\app\\")).toBe("app");
  });

  test("a key that is not a folder keeps what it is", () => {
    expect(projectLabel("github.com/x/y")).toBe("github.com/x/y");
    expect(projectLabel("kA")).toBe("kA");
    expect(projectLabel("/")).toBe("/");
    expect(projectLabel("C:\\")).toBe("C:\\");
  });

  test("two folders that share a name are told apart by the parent, and one level further only if it still clashes", () => {
    expect(labels("/a/app/", "/b/app/")).toEqual(["a/app", "b/app"]);
    expect(labels("C:\\x\\app\\", "C:\\y\\app\\")).toEqual(["x/app", "y/app"]);
    expect(labels("/x/a/app", "/y/a/app")).toEqual(["x/a/app", "y/a/app"]);
    expect(labels("/x/a/app", "/y/a/app", "/z/b/app")).toEqual(["x/a/app", "y/a/app", "b/app"]);
  });

  test("a raw path and a host key of the same folder name are told apart by the host", () => {
    expect(labels("/w/docs-site", "host:alfa:/w/docs-site")).toEqual([
      "docs-site",
      "docs-site · alfa",
    ]);
  });

  test("the folder behind a key is what the tooltip shows, whole", () => {
    expect(projectPath("/tmp/fd-demo/alfa/")).toBe("/tmp/fd-demo/alfa/");
    expect(projectPath("host:alfa:/w/app")).toBe("/w/app");
    expect(projectPath("host:beta:C:\\x\\app\\")).toBe("C:\\x\\app\\");
    expect(projectPath("C:\\work\\app")).toBe("C:\\work\\app");
    expect(projectPath("github.com/x/y")).toBeNull();
    expect(projectPath("kA")).toBeNull();
  });
});
