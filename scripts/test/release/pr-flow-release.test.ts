import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headCi, prFlow, VERSION_FILE } from "../../lib/pr/pr-flow.ts";
import { fake, green } from "./pr-flow-setup.ts";

describe("pr-flow: the CI of a commit and the release tag (#266)", () => {
  test("a commit's required checks read as 0, failed, pending or none", async () => {
    const failing = green().map((r, i) => (i === 0 ? { ...r, conclusion: "failure" } : r));
    const running = green().map((r, i) =>
      i === 1 ? { ...r, status: "queued", conclusion: null } : r,
    );
    const f = fake({ runs: { ok1: green(), red1: failing, run1: running } });
    expect(await headCi("ok1", f.deps)).toBe("0");
    expect(await headCi("red1", f.deps)).toBe("failed");
    expect(await headCi("run1", f.deps)).toBe("pending");
    expect(await headCi("none1", f.deps)).toBe("none");
    expect(await headCi("ok1", fake({ fail: /rules\/branches/ }).deps)).toBe("unknown");
  });

  const COORDINATOR = { FLIGHTDECK_COORDINATOR: "1" };
  // A full run: the schedule's (every 3 hours, #444). A push to main runs a partial one.
  const released = { id: 1, event: "schedule", status: "completed", conclusion: "success" };
  const pushGreen = { id: 2, event: "push", status: "completed", conclusion: "success" };
  const START = "workflow run ci.yml --ref main -f only=all";

  test("tag tags main's HEAD after a green full run of it on main, and pushes the tag alone", async () => {
    const f = fake({
      env: COORDINATOR,
      mainHead: "abc123",
      onMain: ["abc123"],
      mainRuns: { abc123: [released] },
    });
    expect(await prFlow(["tag", "v0.36.5"], f.deps)).toBe(0);
    expect(f.gitWrites).toEqual([
      "tag -a v0.36.5 -m v0.36.5 abc123",
      "push origin refs/tags/v0.36.5",
    ]);
    expect(f.out()).toContain("v0.36.5 tagged on abc123");
  });

  test("tag refuses, and writes nothing, without the coordinator, a green full run, or a free tag on main", async () => {
    const base = { mainHead: "abc123", onMain: ["abc123"], mainRuns: { abc123: [released] } };
    const cases: [Parameters<typeof fake>[0], string[], string][] = [
      [{ ...base }, ["tag", "v0.36.5"], "FLIGHTDECK_COORDINATOR"],
      [{ ...base, env: COORDINATOR }, ["tag", "0.36.5"], "usage: bun run pr --"],
      [
        { ...base, env: COORDINATOR, tags: ["v0.36.5"] },
        ["tag", "v0.36.5"],
        "v0.36.5 exists already",
      ],
      [
        { ...base, env: COORDINATOR },
        ["tag", "v0.36.5", "--commit", "feat9"],
        "feat9 is not on main",
      ],
      [
        { ...base, env: COORDINATOR, mainRuns: {} },
        ["tag", "v0.36.5", "--commit", "abc123"],
        "no full green run of abc123 on main",
      ],
      [
        { ...base, env: COORDINATOR, mainRuns: { abc123: [pushGreen] } },
        ["tag", "v0.36.5", "--commit", "abc123"],
        "abc123 has no full green run on main",
      ],
      [
        {
          ...base,
          env: COORDINATOR,
          mainRuns: { abc123: [{ status: "in_progress", conclusion: null }] },
        },
        ["tag", "v0.36.5"],
        "abc123's CI run on main is still running",
      ],
      [
        {
          ...base,
          env: COORDINATOR,
          mainRuns: { abc123: [{ status: "completed", conclusion: "failure" }] },
        },
        ["tag", "v0.36.5"],
        "abc123's CI run on main did not pass",
      ],
      [{ env: COORDINATOR }, ["tag", "v0.36.5"], "origin/main cannot be read"],
    ];
    for (const [opts, argv, reason] of cases) {
      const f = fake(opts);
      expect(await prFlow(argv, f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain(reason);
    }
  });

  describe("when main's HEAD has no green run because a later merge cancelled it (#376)", () => {
    const cancelled = { status: "completed", conclusion: "cancelled" };
    const stacked = {
      env: COORDINATOR,
      mainHead: "head3",
      onMain: ["head3", "bump2", "old1"],
      history: ["head3", "bump2", "old1"],
      versions: { head3: "0.37.0", bump2: "0.37.0", old1: "0.36.9" },
    };

    test("tag takes the newest commit that has the bump and a green run, and says so", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [cancelled], bump2: [released], old1: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
      expect(f.gitWrites).toEqual([
        "tag -a v0.37.0 -m v0.37.0 bump2",
        "push origin refs/tags/v0.37.0",
      ]);
      expect(f.out()).toContain("head3 has no full green run on main");
      expect(f.out()).toContain("v0.37.0 tagged on bump2");
    });

    test("a commit from before the bump is never taken, and nothing is written", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [cancelled], bump2: [cancelled], old1: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain("no commit with the v0.37.0 bump has one");
    });

    test("a history that is all bump and has no green run refuses", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [cancelled], bump2: [cancelled] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
    });

    test("a commit whose package.json cannot be read ends the search", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "unread4", "bump2"],
        mainRuns: { head3: [cancelled], bump2: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
    });

    test("a run that failed is not skipped over, and --commit asks for exactly that commit", async () => {
      const failed = { status: "completed", conclusion: "failure" };
      const f = fake({ ...stacked, mainRuns: { head3: [failed], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
      const pinned = fake({ ...stacked, mainRuns: { head3: [cancelled], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0", "--commit", "head3"], pinned.deps)).toBe(2);
      expect(pinned.gitWrites).toEqual([]);
    });

    // On a busy main HEAD's push run is queued or going when the release is cut (#529).
    for (const [state, run] of [
      ["in progress", { status: "in_progress", conclusion: null }],
      ["queued", { status: "queued", conclusion: null }],
    ] as const) {
      test(`a HEAD run that is ${state} has not failed: tag takes the newest commit with the bump and a full green run, and says which`, async () => {
        const f = fake({
          ...stacked,
          mainRuns: { head3: [run], bump2: [released], old1: [released] },
        });
        expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
        expect(f.gitWrites).toEqual([
          "tag -a v0.37.0 -m v0.37.0 bump2",
          "push origin refs/tags/v0.37.0",
        ]);
        expect(f.out()).toContain("head3's CI run on main is still running: tagging bump2");
        expect(f.writes).toEqual([]);
      });
    }

    test("a HEAD run still going next to one that failed is a failure: nothing is skipped over", async () => {
      const f = fake({
        ...stacked,
        mainRuns: {
          head3: [
            { status: "in_progress", conclusion: null },
            { status: "completed", conclusion: "failure" },
          ],
          bump2: [released],
        },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
    });

    // HEAD has the bump and no bump commit has a full green run: the full run starts at once, in its own
    // concurrency group, instead of after HEAD's push run settles (#545).
    const waiting = {
      ...stacked,
      history: ["head3", "bump2"],
    };

    test("a HEAD run still going and no earlier green commit: a full run starts at once, tag waits for it and tags nothing", async () => {
      const f = fake({
        ...waiting,
        mainRuns: { head3: [{ status: "queued", conclusion: null }], bump2: [pushGreen] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("head3's CI run on main is still running");
      expect(f.out()).toContain(
        "a full run of main was started; run pr tag again when it is green",
      );
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([START]);
    });

    test("a dispatch of that commit that is queued or going is not started twice", async () => {
      for (const status of ["queued", "in_progress"]) {
        const f = fake({
          ...waiting,
          mainRuns: {
            head3: [
              { id: 5, event: "push", status: "in_progress", conclusion: null },
              { id: 6, event: "workflow_dispatch", status, conclusion: null },
            ],
            bump2: [pushGreen],
          },
        });
        expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
        expect(f.out()).toContain(
          "a full run of main is already going; run pr tag again when it is green",
        );
        expect(f.writes).toEqual([]);
        expect(f.gitWrites).toEqual([]);
      }
    });

    test("a dispatch that already finished does not stop a new one while the push run is going", async () => {
      const f = fake({
        ...waiting,
        mainRuns: {
          head3: [
            { id: 5, event: "push", status: "in_progress", conclusion: null },
            { id: 6, event: "workflow_dispatch", status: "completed", conclusion: "cancelled" },
          ],
          bump2: [pushGreen],
        },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.writes).toEqual([START]);
    });

    test("when GitHub refuses the dispatch of a commit whose run is going, it says how to start one by hand", async () => {
      const f = fake({
        ...waiting,
        mainRuns: { head3: [{ status: "queued", conclusion: null }], bump2: [pushGreen] },
        fail: /^workflow run/,
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("still running");
      expect(f.out()).toContain("start one (gh workflow run ci.yml --ref main -f only=all)");
      expect(f.gitWrites).toEqual([]);
    });

    test("--commit pins a commit whose run is still going: it refuses, and falls back to nothing", async () => {
      const f = fake({
        ...stacked,
        mainRuns: { head3: [{ status: "in_progress", conclusion: null }], bump2: [released] },
      });
      expect(await prFlow(["tag", "v0.37.0", "--commit", "head3"], f.deps)).toBe(2);
      expect(f.out()).toContain("still running");
      expect(f.gitWrites).toEqual([]);
    });
  });

  describe("the gate is a full green run (#444): a push to main runs only a partial one", () => {
    const stacked = {
      env: COORDINATOR,
      mainHead: "head3",
      onMain: ["head3", "bump2", "old1"],
      history: ["head3", "bump2", "old1"],
      versions: { head3: "0.37.0", bump2: "0.37.0", old1: "0.36.9" },
    };

    test("a green push run is no full run: tag takes the newest commit with the bump and a full green run", async () => {
      const f = fake({ ...stacked, mainRuns: { head3: [pushGreen], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(0);
      expect(f.gitWrites).toEqual([
        "tag -a v0.37.0 -m v0.37.0 bump2",
        "push origin refs/tags/v0.37.0",
      ]);
      expect(f.out()).toContain("head3 has no full green run on main");
    });

    test("a dispatch counts as a full run only when its test suite ran and passed", async () => {
      const full = {
        id: 7,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      };
      const screens = {
        id: 8,
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      };
      const runJobs = {
        // Windows is a signal in a full run, never a gate (#534): a red shard does not block the tag.
        7: [
          { name: "test suite (ubuntu-latest) (dispatch)", conclusion: "success" },
          { name: "test shard 1/3 (windows-latest) (dispatch)", conclusion: "failure" },
        ],
        8: [{ name: "test suite (ubuntu-latest) (dispatch)", conclusion: "skipped" }],
      };
      const ok = fake({ ...stacked, mainRuns: { head3: [full] }, runJobs });
      expect(await prFlow(["tag", "v0.37.0"], ok.deps)).toBe(0);
      expect(ok.gitWrites[0]).toBe("tag -a v0.37.0 -m v0.37.0 head3");
      const partial = fake({ ...stacked, mainRuns: { head3: [screens] }, runJobs });
      expect(await prFlow(["tag", "v0.37.0"], partial.deps)).toBe(2);
      expect(partial.gitWrites).toEqual([]);
    });

    test("with no full green run to tag, it starts one on main, asks to run it again, and tags nothing", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [pushGreen], bump2: [pushGreen] },
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([START]);
      expect(f.out()).toContain(
        "a full run of main was started; run pr tag again when it is green",
      );
    });

    test("when GitHub refuses to start the full run, it says how to start one by hand", async () => {
      const f = fake({
        ...stacked,
        history: ["head3", "bump2"],
        mainRuns: { head3: [pushGreen], bump2: [pushGreen] },
        fail: /^workflow run/,
      });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.gitWrites).toEqual([]);
      expect(f.out()).toContain("start one (gh workflow run ci.yml --ref main -f only=all)");
    });

    test("a failed partial run on HEAD is never skipped over, and nothing is started", async () => {
      const failed = { id: 3, event: "push", status: "completed", conclusion: "failure" };
      const f = fake({ ...stacked, mainRuns: { head3: [failed], bump2: [released] } });
      expect(await prFlow(["tag", "v0.37.0"], f.deps)).toBe(2);
      expect(f.out()).toContain("did not pass");
      expect(f.gitWrites).toEqual([]);
      expect(f.writes).toEqual([]);
    });
  });

  test("a tag git refuses to make or push fails with exit 1", async () => {
    const ready = {
      env: { FLIGHTDECK_COORDINATOR: "1" },
      mainHead: "abc123",
      onMain: ["abc123"],
      mainRuns: { abc123: [released] },
    };
    const pushRefused = fake({ ...ready, fail: /^push/ });
    expect(await prFlow(["tag", "v0.36.5"], pushRefused.deps)).toBe(1);
    expect(pushRefused.out()).toContain("the push of v0.36.5 failed");
    const tagRefused = fake({ ...ready, fail: /^tag -a/ });
    expect(await prFlow(["tag", "v0.36.5"], tagRefused.deps)).toBe(1);
    expect(tagRefused.out()).toContain("git refused to make v0.36.5");
    expect(tagRefused.gitWrites).toEqual(["tag -a v0.36.5 -m v0.36.5 abc123"]);
  });
});

describe("pr-flow: where the release tag reads the product version (#559)", () => {
  test("the file greenWithBump reads holds a version in this repo", () => {
    const root = join(import.meta.dir, "../../..");
    const version = (file: string) =>
      (JSON.parse(readFileSync(join(root, file), "utf8")) as { version?: unknown }).version;
    expect(typeof version(VERSION_FILE)).toBe("string");
  });
});
