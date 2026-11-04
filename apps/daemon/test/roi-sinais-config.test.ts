import { afterEach, describe, expect, test } from "bun:test";
import { Project } from "@flightdeck/protocol";
import { RoiSummarizer } from "../src/roi/summary.ts";
import { newBoard } from "./board-helpers.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const open = async () => {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo });
  return { ...ctx, project };
};

describe("roi-sinais-config: the switches of a project", () => {
  test("both signals are off by default, on the wire too", async () => {
    const { project } = await open();
    expect(project.roiSignals).toEqual({ commits: false, issues: false });
    const wire = {
      id: "p",
      path: "/r",
      name: "r",
      baseBranch: "main",
      prProvider: "none",
      setupScript: null,
      promptTemplate: "",
    };
    expect(Project.parse(wire).roiSignals).toEqual({ commits: false, issues: false });
  });

  test("a switch is kept, one at a time, and survives a read", async () => {
    const { board, project } = await open();
    board.updateProject(project.id, { roiSignals: { commits: true } });
    expect(board.getProject(project.id).roiSignals).toEqual({ commits: true, issues: false });
    board.updateProject(project.id, { roiSignals: { issues: true } });
    expect(board.getProject(project.id).roiSignals).toEqual({ commits: true, issues: true });
    board.updateProject(project.id, { roiSignals: { commits: false } });
    expect(board.getProject(project.id).roiSignals).toEqual({ commits: false, issues: true });
    board.updateProject(project.id, { name: "renamed" });
    expect(board.getProject(project.id).roiSignals).toEqual({ commits: false, issues: true });
  });
});

describe("roi-sinais-config: the summary carries the signals a project switched on", () => {
  const filter = { from: "2026-10-01", to: "2026-10-14" };

  test("only for the projects that have them on, and only the ones they have on", async () => {
    const { board, store, project, repo } = await open();
    const asked: string[] = [];
    const roi = new RoiSummarizer({
      db: store.db,
      signals: {
        agentCommits: async (cwd, from, to) => {
          asked.push(`commits ${cwd} ${from} ${to}`);
          return 7;
        },
        issuesClosed: async (cwd) => {
          asked.push(`issues ${cwd}`);
          return { count: 2 };
        },
      },
    });
    const off = await roi.summaryWithSignals(filter);
    expect(off.projects.find((p) => p.name === project.name)?.signals).toBeUndefined();
    expect(asked).toEqual([]);

    board.updateProject(project.id, { roiSignals: { commits: true } });
    const commits = await roi.summaryWithSignals(filter);
    expect(commits.projects.find((p) => p.name === project.name)?.signals).toEqual({
      agentCommits: 7,
    });
    expect(asked).toEqual([`commits ${repo} 2026-10-01 2026-10-14`]);

    board.updateProject(project.id, { roiSignals: { issues: true } });
    const both = await roi.summaryWithSignals(filter);
    expect(both.projects.find((p) => p.name === project.name)?.signals).toEqual({
      agentCommits: 7,
      issuesClosed: 2,
    });
  });

  test("a refused issues answer says why and leaves the commits alone", async () => {
    const { board, store, project } = await open();
    board.updateProject(project.id, { roiSignals: { commits: true, issues: true } });
    const roi = new RoiSummarizer({
      db: store.db,
      signals: {
        agentCommits: async () => 1,
        issuesClosed: async () => ({ error: "gh_logged_out" }),
      },
    });
    const result = await roi.summaryWithSignals(filter);
    expect(result.projects.find((p) => p.name === project.name)?.signals).toEqual({
      agentCommits: 1,
      issuesError: "gh_logged_out",
    });
  });

  test("a project key shared by two folders adds their commits", async () => {
    const { board, store, project, repo } = await open();
    board.updateProject(project.id, { roiSignals: { commits: true } });
    const roi = new RoiSummarizer({
      db: store.db,
      keyOf: () => "same",
      signals: {
        agentCommits: async (cwd) => (cwd === repo ? 3 : 0),
        issuesClosed: async () => ({ count: 0 }),
      },
    });
    const result = await roi.summaryWithSignals(filter);
    expect(result.projects.find((p) => p.projectKey === "same")?.signals).toEqual({
      agentCommits: 3,
    });
  });

  test("without a signals source the summary is the plain one", async () => {
    const { board, store, project } = await open();
    board.updateProject(project.id, { roiSignals: { commits: true } });
    const result = await new RoiSummarizer({ db: store.db }).summaryWithSignals(filter);
    expect(result.projects.every((p) => p.signals === undefined)).toBe(true);
  });
});
