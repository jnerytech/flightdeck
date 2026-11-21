import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { RunResumeCheck, WorkflowInfo, WorkflowTemplateAdded } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HASH = "a1".repeat(32);
const SHIP: WorkflowInfo = {
  name: "ship",
  hash: HASH,
  trusted: true,
  checks: ["bun test"],
  errors: [],
  inputs: ["ticket"],
};
const ADDED: WorkflowTemplateAdded = {
  path: ".flightdeck/workflows/review-loop.yaml",
  branch: "flightdeck/workflow-review-loop",
  base: "main",
  url: "https://github.com/acme/api/pull/7",
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "workflow.trust": () => SHIP,
  "workflow.template.add": () => ADDED,
  "run.resume": (): RunResumeCheck => ({ from: "build", ok: true }),
  ...over,
});

const sent = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const parsed = (argv: string[]): Record<string, unknown> => {
  try {
    return { ...parseArgs(argv) };
  } catch (error) {
    return { refusal: String((error as Error).message).split("\n")[0] };
  }
};

describe("the workflow write arguments (issue #3628)", () => {
  test("trust takes the project, the workflow and the whole hash workflow list printed", () => {
    expect(parsed(["workflow", "trust", "api", "ship", "--hash", HASH])).toMatchObject({
      command: "workflow",
      action: "trust",
      workflowWords: ["api", "ship"],
      hash: HASH,
    });
    expect(parsed(["workflow", "trust", "api", "ship"])).toEqual({ refusal: "missing --hash" });
    expect(parsed(["workflow", "trust", "api", "--hash", HASH])).toHaveProperty("refusal");
    for (const bad of ["a1a1a1a1a1a1", "zz".repeat(32), `${HASH}00`]) {
      expect(parsed(["workflow", "trust", "api", "ship", "--hash", bad])).toHaveProperty(
        "refusal",
        expect.stringContaining("--hash"),
      );
    }
  });

  test("template-add takes the project and the template id, and resume takes the run, each with an optional --confirm", () => {
    expect(parsed(["workflow", "template-add", "api", "review-loop"])).toMatchObject({
      action: "template-add",
      workflowWords: ["api", "review-loop"],
    });
    expect(parsed(["workflow", "template-add", "api", "review-loop", "--confirm"])).toMatchObject({
      confirm: true,
    });
    expect(parsed(["workflow", "resume", "r1", "--confirm"])).toMatchObject({
      action: "resume",
      workflowWords: ["r1"],
      confirm: true,
    });
    expect(parsed(["workflow", "template-add", "api"])).toHaveProperty("refusal");
  });

  test("--hash goes only with trust, and --confirm only with template-add and resume", () => {
    for (const line of [
      ["workflow", "list", "api", "--hash", HASH],
      ["workflow", "resume", "r1", "--hash", HASH],
      ["workflow", "template-add", "api", "review-loop", "--hash", HASH],
      ["workflow", "list", "api", "--confirm"],
      ["workflow", "run", "r1", "--confirm"],
      ["workflow", "validate", "api", "ship", "--confirm"],
      ["workflow", "watch", "--confirm"],
      ["workflow", "trust", "api", "ship", "--hash", HASH, "--confirm"],
    ]) {
      expect(parsed(line)).toHaveProperty("refusal");
    }
  });
});

describe("flightdeckd workflow trust, template-add and resume --confirm (issue #3628)", () => {
  test("trust sends the project, the name and the hash, and prints the workflow as the read does", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "trust", "api", "ship", "--hash", HASH], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([`ship  ${HASH}  trusted`, "  input: ticket", "  check: bun test"]);
    expect(sent(daemon, "workflow.trust")).toEqual([{ projectId: "p1", name: "ship", hash: HASH }]);
    const json = await flightdeckd(
      ["workflow", "trust", "api", "ship", "--hash", HASH, "--json"],
      daemon.port,
    );
    expect(JSON.parse(json.out.join("\n"))).toEqual(SHIP);
  });

  test("a workflow that changed since the hash was read is the daemon's refusal: exit 1, its text, trust given to nothing", async () => {
    const daemon = fakeDaemon(
      base({
        "workflow.trust": () => ({
          error: { code: "invalid_state", message: "the workflow ship changed since you read it" },
        }),
      }),
    );
    const run = await flightdeckd(["workflow", "trust", "api", "ship", "--hash", HASH], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("changed since you read it"),
    ]);
  });

  test("an unknown project is refused with exit 1 before anything is trusted", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "trust", "nope", "ship", "--hash", HASH], daemon.port);
    expect(run.code).toBe(1);
    expect(sent(daemon, "workflow.trust")).toEqual([]);
  });

  test("template-add sends the confirm only when asked, and prints the file, the branch, the base and the PR", async () => {
    const daemon = fakeDaemon(
      base({
        "workflow.template.add": (p) =>
          p.confirm === true
            ? ADDED
            : { error: { code: "confirm_required", message: "add the template with confirm" } },
      }),
    );
    const without = await flightdeckd(["workflow", "template-add", "api", "review-loop"], daemon.port);
    expect([without.code, without.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("with confirm"),
    ]);
    const run = await flightdeckd(
      ["workflow", "template-add", "api", "review-loop", "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: [
        `${ADDED.path}  branch ${ADDED.branch}  base ${ADDED.base}`,
        `pr  ${ADDED.url}`,
      ],
    });
    expect(sent(daemon, "workflow.template.add")).toEqual([
      { projectId: "p1", templateId: "review-loop" },
      { projectId: "p1", templateId: "review-loop", confirm: true },
    ]);
    const json = await flightdeckd(
      ["workflow", "template-add", "api", "review-loop", "--confirm", "--json"],
      daemon.port,
    );
    expect(JSON.parse(json.out.join("\n"))).toEqual(ADDED);
  });

  test("resume --confirm resumes the run and says from which step; --json prints the answer", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["workflow", "resume", "r1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 0, out: ["r1 resumed from build"] });
    expect(sent(daemon, "run.resume")).toEqual([{ runId: "r1", confirm: true }]);
    const json = await flightdeckd(["workflow", "resume", "r1", "--confirm", "--json"], daemon.port);
    expect(JSON.parse(json.out.join("\n"))).toEqual({ from: "build", ok: true });
  });

  test("a far connection is the daemon's refusal for resume --confirm and template-add: exit 1, its text", async () => {
    const refuse = () => ({
      error: { code: "transport_refused", message: "only from this computer" },
    });
    const daemon = fakeDaemon(base({ "run.resume": refuse, "workflow.template.add": refuse }));
    const resume = await flightdeckd(["workflow", "resume", "r1", "--confirm"], daemon.port);
    const add = await flightdeckd(
      ["workflow", "template-add", "api", "review-loop", "--confirm"],
      daemon.port,
    );
    expect([resume.code, add.code]).toEqual([1, 1]);
    expect(resume.err.join("\n")).toContain("only from this computer");
  });

  test("a resume the daemon answers with ok false exits 1 and says why", async () => {
    const daemon = fakeDaemon(
      base({ "run.resume": (): RunResumeCheck => ({ from: "", ok: false, reason: "run_resume_no_head" }) }),
    );
    const run = await flightdeckd(["workflow", "resume", "r1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 1,
      out: ["r1 cannot resume: run_resume_no_head"],
    });
  });

  test("a connection lost while a write is in flight says it may or may not have happened", async () => {
    for (const argv of [
      ["workflow", "trust", "api", "ship", "--hash", HASH],
      ["workflow", "template-add", "api", "review-loop", "--confirm"],
      ["workflow", "resume", "r1", "--confirm"],
    ]) {
      const daemon = fakeDaemon(
        base({ "workflow.trust": () => CLOSE, "workflow.template.add": () => CLOSE, "run.resume": () => CLOSE }),
      );
      const run = await flightdeckd(argv, daemon.port);
      expect([argv[1], run.code, run.err.join("\n").includes("may or may not")]).toEqual([
        argv[1],
        2,
        true,
      ]);
    }
  });
});
