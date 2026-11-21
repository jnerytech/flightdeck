import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const TRIGGER = { type: "cron", expr: "0 3 * * *", tz: "Europe/Lisbon" };
const ACTION = { type: "start_workflow", workflow: "triage" };

const NIGHTLY = {
  id: "a1",
  projectId: "p1",
  name: "Nightly triage",
  enabled: false,
  trigger: TRIGGER,
  action: ACTION,
  maxRunsPerDay: 5,
  allowExternalAuthors: false,
  createdAt: "2026-11-01T09:00:00.000Z",
};

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "automation.list": () => ({ automations: [NIGHTLY] }),
  "automation.save": () => NIGHTLY,
  "automation.toggle": (payload) => ({ ...NIGHTLY, enabled: payload.enabled === true }),
  "automation.remove": () => ({ automations: [] }),
};

/** A definition file with the text the person wrote. */
function definition(text: string): string {
  const file = join(tempDir("automation-definition-"), "definition.json");
  writeFileSync(file, text);
  return file;
}

const GOOD = () => definition(JSON.stringify({ trigger: TRIGGER, action: ACTION }));

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const writes = (daemon: ReturnType<typeof fakeDaemon>) =>
  daemon.calls.filter((c) => c.type.startsWith("automation."));

describe("flightdeckd automation save (issue #3627)", () => {
  test("a new automation: the trigger and the action come from the file, the scalars from flags, and it is saved off", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "automation",
        "save",
        "api",
        "--name",
        "Nightly triage",
        "--definition-file",
        GOOD(),
        "--max-runs",
        "5",
        "--external-authors",
        "off",
      ],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [
        "saved a1: Nightly triage, off, cron 0 3 * * * (Europe/Lisbon), start workflow triage, up to 5 runs a day",
      ],
      err: [],
    });
    expect(callsOf(daemon, "automation.save")).toEqual([
      {
        projectId: "p1",
        name: "Nightly triage",
        trigger: TRIGGER,
        action: ACTION,
        maxRunsPerDay: 5,
        allowExternalAuthors: false,
      },
    ]);
  });

  test("--automation edits that automation, and what the flags leave out stays out of the request", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "automation",
        "save",
        "p1",
        "--automation",
        "a1",
        "--name",
        "Nightly",
        "--definition-file",
        GOOD(),
      ],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "automation.save")).toEqual([
      { projectId: "p1", id: "a1", name: "Nightly", trigger: TRIGGER, action: ACTION },
    ]);
  });

  test("--json prints the saved automation with every key", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["automation", "save", "api", "--name", "N", "--definition-file", GOOD(), "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      ...NIGHTLY,
      action: { ...ACTION, inputs: null, title: null, description: null },
    });
  });

  test("a file that cannot be read, is not JSON or does not fit is refused with exit 1 before the daemon is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const argv = (file: string) => [
      "automation",
      "save",
      "api",
      "--name",
      "N",
      "--definition-file",
      file,
    ];
    const missing = await flightdeckd(argv("/nonexistent/definition.json"), daemon.port);
    const notJson = await flightdeckd(argv(definition("{ trigger:")), daemon.port);
    const noAction = await flightdeckd(
      argv(definition(JSON.stringify({ trigger: TRIGGER }))),
      daemon.port,
    );
    const badTrigger = await flightdeckd(
      argv(definition(JSON.stringify({ trigger: { type: "hourly" }, action: ACTION }))),
      daemon.port,
    );
    expect([missing.code, notJson.code, noAction.code, badTrigger.code]).toEqual([1, 1, 1, 1]);
    expect(missing.err.join("\n")).toContain("cannot read the definition file");
    expect(notJson.err.join("\n")).toContain("is not JSON");
    expect(noAction.err.join("\n")).toContain("does not fit");
    expect(badTrigger.err.join("\n")).toContain("does not fit");
    expect(writes(daemon)).toEqual([]);
  });

  test("--automation names an automation of that project: another project's id is refused before anything is saved", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "automation",
        "save",
        "api",
        "--automation",
        "a9",
        "--name",
        "N",
        "--definition-file",
        GOOD(),
      ],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("a9 is not an automation of api");
    expect(callsOf(daemon, "automation.save")).toEqual([]);
  });

  test("a key the file carries besides the trigger and the action is refused, not dropped", async () => {
    const daemon = fakeDaemon(OPEN);
    const file = definition(
      JSON.stringify({ trigger: TRIGGER, action: ACTION, maxRunsPerDay: 1, enabled: true }),
    );
    const run = await flightdeckd(
      ["automation", "save", "api", "--name", "N", "--definition-file", file],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("does not fit");
    expect(callsOf(daemon, "automation.save")).toEqual([]);
  });

  test("--max-runs past the safe integers is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      [
        "automation",
        "save",
        "api",
        "--name",
        "N",
        "--definition-file",
        GOOD(),
        "--max-runs",
        "99999999999999999999999",
      ],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(daemon.calls).toEqual([]);
  });

  test("a missing name or file, a bad count and a bad choice are refused with exit 1 and ask nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const file = GOOD();
    const noName = await flightdeckd(
      ["automation", "save", "api", "--definition-file", file],
      daemon.port,
    );
    const noFile = await flightdeckd(["automation", "save", "api", "--name", "N"], daemon.port);
    const zero = await flightdeckd(
      ["automation", "save", "api", "--name", "N", "--definition-file", file, "--max-runs", "0"],
      daemon.port,
    );
    const maybe = await flightdeckd(
      [
        "automation",
        "save",
        "api",
        "--name",
        "N",
        "--definition-file",
        file,
        "--external-authors",
        "maybe",
      ],
      daemon.port,
    );
    expect([noName.code, noFile.code, zero.code, maybe.code]).toEqual([1, 1, 1, 1]);
    expect(noName.err.join("\n")).toContain("missing --name");
    expect(noFile.err.join("\n")).toContain("missing --definition-file");
    expect(daemon.calls).toEqual([]);
  });

  test("a refusal from the daemon is one line on stderr and exit 1; a dead daemon is exit 2 and the change may have gone in", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "automation.save": () => ({
        error: { code: "bad_request", message: "the automation needs a name" },
      }),
    });
    const dying = fakeDaemon({ ...OPEN, "automation.save": () => CLOSE });
    const args = ["automation", "save", "api", "--name", "N", "--definition-file", GOOD()];
    const refused = await flightdeckd(args, refusing.port);
    const gone = await flightdeckd(args, dying.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("the automation needs a name");
    expect(gone.code).toBe(2);
    expect(gone.err.join("\n")).toContain("may or may not have been made");
  });
});

describe("flightdeckd automation enable, disable and remove (issue #3627)", () => {
  test("enable --confirm turns it on and prints the automation", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "enable", "a1", "--confirm"], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({
      code: 0,
      out: [
        "enabled a1: Nightly triage, on, cron 0 3 * * * (Europe/Lisbon), start workflow triage, up to 5 runs a day",
      ],
    });
    expect(callsOf(daemon, "automation.toggle")).toEqual([
      { id: "a1", enabled: true, confirm: true },
    ]);
  });

  test("disable turns it off without a confirmation", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["automation", "disable", "a1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      ...NIGHTLY,
      enabled: false,
      action: { ...ACTION, inputs: null, title: null, description: null },
    });
    expect(callsOf(daemon, "automation.toggle")).toEqual([{ id: "a1", enabled: false }]);
  });

  test("remove --confirm deletes it, names it, and --json prints what is left", async () => {
    const daemon = fakeDaemon(OPEN);
    const text = await flightdeckd(["automation", "remove", "a1", "--confirm"], daemon.port);
    const json = await flightdeckd(
      ["automation", "remove", "a1", "--confirm", "--json"],
      daemon.port,
    );
    expect({ code: text.code, out: text.out }).toEqual({ code: 0, out: ["removed a1"] });
    expect(printed(json.out)).toEqual({ automations: [] });
    expect(callsOf(daemon, "automation.remove")).toEqual([
      { id: "a1", confirm: true },
      { id: "a1", confirm: true },
    ]);
  });

  test("enable and remove without --confirm are refused with exit 1 and ask nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const enable = await flightdeckd(["automation", "enable", "a1"], daemon.port);
    const remove = await flightdeckd(["automation", "remove", "a1"], daemon.port);
    expect([enable.code, remove.code]).toEqual([1, 1]);
    expect(enable.err.join("\n")).toContain("pass --confirm");
    expect(remove.err.join("\n")).toContain("pass --confirm");
    expect(daemon.calls).toEqual([]);
  });

  test("an unknown automation is the daemon's refusal; a dead daemon on a remove is exit 2 and may have gone through", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "automation.toggle": () => ({
        error: { code: "not_found", message: "automation nope does not exist" },
      }),
    });
    const dying = fakeDaemon({ ...OPEN, "automation.remove": () => CLOSE });
    const refused = await flightdeckd(["automation", "disable", "nope"], refusing.port);
    const gone = await flightdeckd(["automation", "remove", "a1", "--confirm"], dying.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("automation nope does not exist");
    expect(gone.code).toBe(2);
    expect(gone.err.join("\n")).toContain("may or may not have been made");
  });
});

describe("flightdeckd automation write flags (issue #3627)", () => {
  test("a flag on a verb that does not take it is refused with exit 1", async () => {
    const daemon = fakeDaemon(OPEN);
    const file = GOOD();
    const refused = await Promise.all([
      flightdeckd(["automation", "list", "api", "--max-runs", "3"], daemon.port),
      flightdeckd(["automation", "list", "api", "--definition-file", file], daemon.port),
      flightdeckd(["automation", "runs", "a1", "--confirm"], daemon.port),
      flightdeckd(["automation", "disable", "a1", "--confirm"], daemon.port),
      flightdeckd(["automation", "enable", "a1", "--confirm", "--max-runs", "3"], daemon.port),
      flightdeckd(["automation", "save", "api", "--confirm", "--name", "N"], daemon.port),
      flightdeckd(["automation", "remove", "a1", "--confirm", "--automation", "a1"], daemon.port),
    ]);
    expect(refused.map((run) => run.code)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(daemon.calls).toEqual([]);
  });
});
