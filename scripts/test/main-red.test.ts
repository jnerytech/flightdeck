import { describe, expect, test } from "bun:test";
import { latestMainRun, mainRed, mainRedLine, openClaims } from "../lib/main-red.ts";
import type { GhResult } from "../lib/pr-flow.ts";

/**
 * Issue #1246: a red main is claimed once. Every `gh` here is a fake that answers by its
 * arguments and records what was asked; nothing reaches GitHub.
 */

const RED_RUN = {
  databaseId: 7,
  conclusion: "failure",
  createdAt: "2026-11-08T21:07:02Z",
  url: "https://github.com/o/r/actions/runs/7",
};
const GREEN_RUN = {
  databaseId: 9,
  conclusion: "success",
  createdAt: "2026-11-08T22:00:00Z",
  url: "https://github.com/o/r/actions/runs/9",
};
const CANCELLED = { ...GREEN_RUN, databaseId: 8, conclusion: "cancelled" };
const LOG = [
  "test\tRun tests\t2026-11-08T21:10:00Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:01Z (fail) protocolo-compat > host.info traz os recursos [77.35ms]",
  "test\tRun tests\t2026-11-08T21:10:02Z (fail) card detail > opens on changes [3.10ms]",
].join("\n");

/** An open claim as the tool writes it. */
function issue(number: number, owner: string, failing: string[], cause = "typecheck") {
  return {
    number,
    title: `main red: ${cause}`,
    body: [
      `Cause: ${cause}`,
      `Owner: ${owner}`,
      "Run: https://github.com/o/r/actions/runs/7",
      "Run at: 2026-11-08T21:07:02Z",
      "Failing:",
      ...failing.map((f) => `- ${f}`),
    ].join("\n"),
  };
}

function fakeGh(opts: {
  runs?: object[];
  claims?: object[];
  log?: string;
  jobs?: object[];
  createFails?: string;
}) {
  const asked: string[][] = [];
  const gh = async (args: string[]): Promise<GhResult> => {
    asked.push(args);
    const line = args.join(" ");
    if (line.startsWith("run list")) return { code: 0, stdout: JSON.stringify(opts.runs ?? []) };
    if (line.startsWith("run view") && args.includes("--log-failed")) {
      return { code: 0, stdout: opts.log ?? "" };
    }
    if (line.startsWith("run view")) {
      return { code: 0, stdout: JSON.stringify({ jobs: opts.jobs ?? [] }) };
    }
    if (line.startsWith("issue list")) {
      return { code: 0, stdout: JSON.stringify(opts.claims ?? []) };
    }
    if (line.startsWith("issue create")) {
      if (opts.createFails) return { code: 1, stdout: "", stderr: opts.createFails };
      return { code: 0, stdout: "https://github.com/o/r/issues/31\n" };
    }
    if (line.startsWith("issue close")) return { code: 0, stdout: "" };
    return { code: 1, stdout: "", stderr: `unexpected gh ${line}` };
  };
  return { gh, asked };
}

function run(args: string[], fake: ReturnType<typeof fakeGh>, owner = "fd-harness") {
  const lines: string[] = [];
  return {
    lines,
    code: mainRed(args, { gh: fake.gh, log: (l) => lines.push(l), owner }),
  };
}

const created = (asked: string[][]) => asked.filter((a) => a[0] === "issue" && a[1] === "create");

describe("main-red: one claim per red main (#1246)", () => {
  test("main's state is its latest run that finished green or red, a cancelled one skipped", async () => {
    const red = await latestMainRun(fakeGh({ runs: [CANCELLED, RED_RUN, GREEN_RUN] }));
    expect(red).toEqual({ id: 7, url: RED_RUN.url, createdAt: RED_RUN.createdAt, red: true });
    expect((await latestMainRun(fakeGh({ runs: [GREEN_RUN] })))?.red).toBe(false);
    expect(await latestMainRun(fakeGh({ runs: [CANCELLED] }))).toBe(null);
  });

  test("a claim is read back from its issue: cause, owner, failing tests and the run's time", async () => {
    const claims = await openClaims(fakeGh({ claims: [issue(30, "fd-qa", ["a > b", "c > d"])] }));
    expect(claims).toEqual([
      {
        number: 30,
        cause: "typecheck",
        owner: "fd-qa",
        failing: ["a > b", "c > d"],
        runAt: "2026-11-08T21:07:02Z",
      },
    ]);
  });

  test("the warning names the claim and its owner, says how to claim when unclaimed, and is silent on green or when GitHub cannot say", async () => {
    const claimed = fakeGh({ runs: [RED_RUN], claims: [issue(30, "fd-qa", ["x"])] });
    expect(await mainRedLine(claimed)).toBe(
      `main is red since ${RED_RUN.url}: typecheck (#30, fd-qa); do not start a parallel fix`,
    );
    expect(await mainRedLine(fakeGh({ runs: [RED_RUN] }))).toBe(
      `main is red since ${RED_RUN.url}, unclaimed: bun run main-red -- claim "<cause>" before fixing it`,
    );
    expect(await mainRedLine(fakeGh({ runs: [GREEN_RUN] }))).toBe(null);
    // When GitHub cannot answer, the warning says nothing rather than guess.
    const down = async (): Promise<GhResult> => ({ code: 1, stdout: "", stderr: "offline" });
    const throws = async (): Promise<GhResult> => {
      throw new Error("gh missing");
    };
    expect([await mainRedLine({ gh: down }), await mainRedLine({ gh: throws })]).toEqual([
      null,
      null,
    ]);
  });

  test("a claim opens one labelled issue with the failing tests, the run and the owner", async () => {
    const fake = fakeGh({ runs: [RED_RUN], log: LOG });
    const { lines, code } = run(["claim", "typecheck after #1227 and #1240"], fake);
    expect(await code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect([
      create?.[create.indexOf("--title") + 1],
      create?.[create.indexOf("--label") + 1],
    ]).toEqual(["main red: typecheck after #1227 and #1240", "main-red"]);
    expect(body.split("\n")).toEqual([
      "Cause: typecheck after #1227 and #1240",
      "Owner: fd-harness",
      `Run: ${RED_RUN.url}`,
      `Run at: ${RED_RUN.createdAt}`,
      "Failing:",
      "- protocolo-compat > host.info traz os recursos",
      "- card detail > opens on changes",
    ]);
    expect(lines.at(-1) ?? "").toBe("claimed: https://github.com/o/r/issues/31");
  });

  test("a second claim on a failing test someone owns is refused and names the owner; the owner's own claim is reused", async () => {
    const owned = [issue(30, "fd-qa", ["card detail > opens on changes"])];
    const other = fakeGh({ runs: [RED_RUN], log: LOG, claims: owned });
    const refused = run(["claim", "same red"], other);
    expect(await refused.code).toBe(1);
    expect(refused.lines.at(-1) ?? "").toBe(
      "already claimed: #30 by fd-qa (typecheck); help there instead of a parallel fix",
    );
    const mine = fakeGh({ runs: [RED_RUN], log: LOG, claims: owned });
    const reused = run(["claim", "same red"], mine, "fd-qa");
    expect(await reused.code).toBe(0);
    expect(reused.lines.at(-1) ?? "").toBe("already yours: #30");
    expect([created(other.asked).length, created(mine.asked).length]).toEqual([0, 0]);
  });

  test("with no test name in the log, the failed jobs are what a claim holds", async () => {
    const fake = fakeGh({
      runs: [RED_RUN],
      log: "",
      jobs: [
        { name: "typecheck", conclusion: "failure" },
        { name: "lint", conclusion: "success" },
      ],
    });
    const { code } = run(["claim", "typecheck", "--by", "fd-dev"], fake);
    expect(await code).toBe(0);
    const [create] = created(fake.asked);
    const body = create?.[create.indexOf("--body") + 1] ?? "";
    expect(body.split("\n").slice(1, 2)).toEqual(["Owner: fd-dev"]);
    expect(body.split("\n").slice(-1)).toEqual(["- job: typecheck"]);
  });

  test("a claim on a green main, or with no cause, is refused; a missing label is named, never created", async () => {
    const green = run(["claim", "x"], fakeGh({ runs: [GREEN_RUN] }));
    const bare = run(["claim"], fakeGh({ runs: [RED_RUN], log: LOG }));
    const noLabel = fakeGh({
      runs: [RED_RUN],
      log: LOG,
      createFails: "could not add label: 'main-red' not found",
    });
    const missing = run(["claim", "x"], noLabel);
    expect([await green.code, await bare.code, await missing.code]).toEqual([1, 2, 1]);
    expect(green.lines.at(-1) ?? "").toBe("main is green: there is nothing to claim");
    expect(missing.lines.at(-1) ?? "").toBe(
      "the main-red label is missing: ask fd-coordinator to create it (the tool never creates labels)",
    );
    expect(noLabel.asked.some((a) => a[0] === "label")).toBe(false);
  });

  test("the status lists what fails and who owns it while red, and closes the claims once a newer run is green", async () => {
    const red = fakeGh({ runs: [RED_RUN], log: LOG, claims: [issue(30, "fd-qa", ["x"])] });
    const shown = run([], red);
    expect(await shown.code).toBe(1);
    expect(shown.lines).toEqual([
      `main is red: ${RED_RUN.url}`,
      "failing: protocolo-compat > host.info traz os recursos",
      "failing: card detail > opens on changes",
      "claimed: #30 by fd-qa (typecheck)",
    ]);
    const green = fakeGh({ runs: [GREEN_RUN], claims: [issue(30, "fd-qa", ["x"])] });
    const closed = run([], green);
    expect(await closed.code).toBe(0);
    expect(closed.lines).toEqual([`main is green: ${GREEN_RUN.url}`, "closed: #30 (fd-qa)"]);
    const close = green.asked.find((a) => a[0] === "issue" && a[1] === "close");
    expect(close?.slice(0, 3) ?? []).toEqual(["issue", "close", "30"]);
    expect(close?.[close.indexOf("--comment") + 1] ?? "").toBe(
      `main is green again: ${GREEN_RUN.url}`,
    );
  });

  test("an unknown subcommand prints the usage", async () => {
    const { lines, code } = run(["clame", "x"], fakeGh({}));
    expect(await code).toBe(2);
    expect(lines.at(-1) ?? "").toBe('usage: bun run main-red [-- claim "<cause>" [--by <name>]]');
  });
});
