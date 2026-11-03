import { describe, expect, test } from "bun:test";
import { groupByProject, hiddenProject, projectCwd, projectLabel } from "../src/lib/usage-rows.ts";

describe("uso-tabela: the rows of a host's usage", () => {
  test("a folder key is labelled by its folder and gives its cwd, whatever the slash", () => {
    expect(projectLabel("host:h1:/home/ana/entrevista")).toBe("entrevista");
    expect(projectLabel("host:h1:C:\\Users\\ana\\entrevista\\")).toBe("entrevista");
    expect(projectCwd("host:h1:/home/ana/entrevista")).toBe("/home/ana/entrevista");
    expect(projectCwd("host:h1:C:\\Users\\ana\\entrevista")).toBe("C:\\Users\\ana\\entrevista");
  });

  test("a remote key is labelled by its repository and has no cwd", () => {
    expect(projectLabel("github.com/acme/repo")).toBe("repo");
    expect(projectCwd("github.com/acme/repo")).toBeNull();
  });

  test("temp folders and agent worktrees are hidden, projects are not", () => {
    for (const key of [
      "host:h1:/tmp/x",
      "host:h1:C:\\Users\\ana\\AppData\\Local\\Temp\\run-1",
      "host:h1:/var/folders/ab/cd/T",
      "host:h1:/home/ana/app/.claude/worktrees/agent-7",
    ]) {
      expect(hiddenProject(key)).toBe(true);
    }
    for (const key of [
      "host:h1:/home/ana/entrevista",
      "host:h1:/home/ana/template",
      "github.com/acme/tmp-tools",
    ]) {
      expect(hiddenProject(key)).toBe(false);
    }
  });

  test("rows group by project, biggest total first, days newest first, hidden ones out", () => {
    const groups = groupByProject([
      { day: "2026-10-14", projectKey: "github.com/acme/a", costUsd: 2 },
      { day: "2026-10-15", projectKey: "host:h1:/tmp/z", costUsd: 99 },
      { day: "2026-10-15", projectKey: "host:h1:/home/ana/b", costUsd: 5 },
      { day: "2026-10-15", projectKey: "github.com/acme/a", costUsd: 1.5 },
    ]);
    expect(groups.map((g) => [g.label, g.costUsd, g.rows.map((r) => r.day)])).toEqual([
      ["b", 5, ["2026-10-15"]],
      ["a", 3.5, ["2026-10-15", "2026-10-14"]],
    ]);
    expect(groups[0]?.cwd).toBe("/home/ana/b");
    expect(groups[1]?.cwd).toBeNull();
  });
});
