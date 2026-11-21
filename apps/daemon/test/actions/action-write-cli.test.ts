import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HASH = "a".repeat(64);
const OLD_HASH = "b".repeat(64);

/** An action as `actions.save` and `actions.trust` answer it: the whole declaration, which a CLI must not print. */
const info = (extra: Record<string, unknown> = {}) => ({
  name: "deploy",
  description: "deploy does its job",
  source: "app",
  projectId: "p1",
  host: null,
  ssh: null,
  run: ["deploy.sh", "--token", "{{secret.token}}"],
  cwd: "/srv/app",
  env: { TOKEN: "{{secret.token}}" },
  params: { branch: { pattern: "^[a-z]+$", default: "main" } },
  timeoutS: 60,
  approval: "always",
  tags: ["prod"],
  secrets: { values: ["token"], files: [] },
  trusted: true,
  changed: [],
  hash: HASH,
  ...extra,
});

const DEFINITION = { name: "deploy", run: ["deploy.sh", "--token", "{{secret.token}}"] };

const OPEN: Handlers = {
  "project.list": () => ({
    projects: [project("p1", "api"), project("p2", "web"), project("p3", "web")],
    maxParallelRuns: 2,
  }),
  "actions.save": () => info(),
  "actions.trust": () => info(),
  "actions.remove": () => ({ actions: [info({ name: "build" })], errors: [] }),
  "actions.list": () => ({ actions: [info({ trusted: false, hash: OLD_HASH })], errors: [] }),
};

/** A definition file with the text the person wrote. */
function definition(text: string): string {
  const file = join(tempDir("action-definition-"), "definition.json");
  writeFileSync(file, text);
  return file;
}

const GOOD = () => definition(JSON.stringify(DEFINITION));

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
  daemon.calls.filter((c) => /^actions\.(save|trust|remove)$/.test(c.type));

describe("flightdeckd action save (issue #3629)", () => {
  test("the definition goes to the daemon as the file has it, for the project named, and the saved action is printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["action", "save", "--project", "api", "--definition-file", GOOD()],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [`saved deploy: deploy does its job, trusted, approval always, hash ${HASH}`],
      err: [],
    });
    expect(callsOf(daemon, "actions.save")).toEqual([{ projectId: "p1", definition: DEFINITION }]);
  });

  test("with no project the action is the host's: the daemon is not asked for projects", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "save", "--definition-file", GOOD()], daemon.port);
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "actions.save")).toEqual([{ definition: DEFINITION }]);
    expect(callsOf(daemon, "project.list")).toEqual([]);
  });

  test("--secret-ids sends the ids the vault has, so the daemon can refuse another secret", async () => {
    const daemon = fakeDaemon(OPEN);
    await flightdeckd(
      ["action", "save", "--definition-file", GOOD(), "--secret-ids", "token,deploy-key"],
      daemon.port,
    );
    expect(callsOf(daemon, "actions.save")).toEqual([
      { definition: DEFINITION, secretIds: ["token", "deploy-key"] },
    ]);
  });

  test("--json prints the action with its hash and nothing that runs", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["action", "save", "--definition-file", GOOD(), "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toEqual({
      name: "deploy",
      description: "deploy does its job",
      approval: "always",
      params: info().params,
      hash: HASH,
      trusted: true,
      changed: [],
    });
    for (const key of ["run", "env", "secrets", "cwd"])
      expect(run.out.join("\n")).not.toContain(`"${key}"`);
    expect(run.out.join("\n")).not.toContain("deploy.sh");
  });

  test("a file that cannot be read, is not JSON or is not an object is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const missing = await flightdeckd(
      ["action", "save", "--definition-file", "/no/such/definition.json"],
      daemon.port,
    );
    const broken = await flightdeckd(
      ["action", "save", "--definition-file", definition("{ nope")],
      daemon.port,
    );
    const list = await flightdeckd(
      ["action", "save", "--definition-file", definition("[1, 2]")],
      daemon.port,
    );
    expect([missing.code, broken.code, list.code]).toEqual([1, 1, 1]);
    expect(missing.err.join("\n")).toContain("cannot read the definition file");
    expect(list.err.join("\n")).toContain("the definition file");
    expect(daemon.calls).toEqual([]);
  });

  test("a refusal from the daemon is its text on stderr and exit 1; a dead daemon is exit 2 and the save may have gone in", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "actions.save": () => ({
        error: { code: "bad_request", message: "secret token is not in the vault" },
      }),
    });
    const dying = fakeDaemon({ ...OPEN, "actions.save": () => CLOSE });
    const args = ["action", "save", "--definition-file", GOOD(), "--secret-ids", "other"];
    const refused = await flightdeckd(args, refusing.port);
    const gone = await flightdeckd(args, dying.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("secret token is not in the vault");
    expect(gone.code).toBe(2);
    expect(gone.err.join("\n")).toContain("may or may not have been made");
    expect(gone.err.join("\n")).toContain("action list");
  });

  test("a project name two projects share is refused with exit 1 and saves nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["action", "save", "--project", "web", "--definition-file", GOOD()],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("the name of several projects");
    expect(writes(daemon)).toEqual([]);
  });
});

describe("flightdeckd action trust (issue #3629)", () => {
  test("the hash goes to the daemon with the name, and the trusted action is printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["action", "trust", "deploy", "--project", "api", "--hash", HASH],
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [`trusted deploy: deploy does its job, trusted, approval always, hash ${HASH}`],
      err: [],
    });
    expect(callsOf(daemon, "actions.trust")).toEqual([
      { projectId: "p1", name: "deploy", hash: HASH },
    ]);
  });

  test("--json prints the action with trusted true and nothing that runs", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["action", "trust", "deploy", "--hash", HASH, "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toMatchObject({ name: "deploy", trusted: true, hash: HASH });
    for (const key of ["run", "env", "secrets", "cwd"])
      expect(run.out.join("\n")).not.toContain(`"${key}"`);
  });

  test("a hash that no longer matches trusts nothing, exits 1 and prints the current hash to compare", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "actions.trust": () => ({
        error: {
          code: "invalid_state",
          message: "action deploy changed; review it again before trusting it",
          reason: "action_changed_review",
        },
      }),
    });
    const run = await flightdeckd(
      ["action", "trust", "deploy", "--project", "api", "--hash", HASH],
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("action deploy changed; review it again");
    expect(run.err.join("\n")).toContain(`its hash now is ${OLD_HASH}`);
    expect(callsOf(daemon, "actions.list")).toEqual([{ projectId: "p1" }]);
  });

  test("a refused trust stays a refusal when the current hash cannot be read: no 'may have been made'", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "actions.trust": () => ({
        error: {
          code: "invalid_state",
          message: "action deploy changed; review it again before trusting it",
          reason: "action_changed_review",
        },
      }),
      "actions.list": () => CLOSE,
    });
    const run = await flightdeckd(["action", "trust", "deploy", "--hash", HASH], daemon.port);
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("action deploy changed; review it again");
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("any other refusal is the daemon's text and asks for no hash; a dead daemon says the trust may have gone in", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "actions.trust": () => ({
        error: { code: "not_found", message: "action deploy does not exist" },
      }),
    });
    const dying = fakeDaemon({ ...OPEN, "actions.trust": () => CLOSE });
    const args = ["action", "trust", "deploy", "--hash", HASH];
    const refused = await flightdeckd(args, refusing.port);
    const gone = await flightdeckd(args, dying.port);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("action deploy does not exist");
    expect(callsOf(refusing, "actions.list")).toEqual([]);
    expect(gone.code).toBe(2);
    expect(gone.err.join("\n")).toContain("may or may not have been made");
  });
});

describe("flightdeckd action remove (issue #3629)", () => {
  test("the name goes to the daemon and what is left is printed", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "remove", "deploy", "--project", "api"], daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["removed deploy", `build: deploy does its job, trusted, approval always, hash ${HASH}`],
      err: [],
    });
    expect(callsOf(daemon, "actions.remove")).toEqual([{ projectId: "p1", name: "deploy" }]);
  });

  test("--json prints the remaining actions as list does", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["action", "remove", "deploy", "--json"], daemon.port);
    expect(printed(run.out)).toMatchObject({
      actions: [{ name: "build", hash: HASH }],
      errors: [],
      issues: null,
    });
    expect(run.out.join("\n")).not.toContain("deploy.sh");
  });

  test("an unknown name is the daemon's refusal, exit 1; a dead daemon says the removal may have gone in", async () => {
    const refusing = fakeDaemon({
      ...OPEN,
      "actions.remove": () => ({
        error: { code: "not_found", message: "action nope does not exist" },
      }),
    });
    const dying = fakeDaemon({ ...OPEN, "actions.remove": () => CLOSE });
    const refused = await flightdeckd(["action", "remove", "nope"], refusing.port);
    const gone = await flightdeckd(["action", "remove", "nope"], dying.port);
    expect({ code: refused.code, out: refused.out }).toEqual({ code: 1, out: [] });
    expect(refused.err.join("\n")).toContain("action nope does not exist");
    expect(gone.code).toBe(2);
    expect(gone.err.join("\n")).toContain("may or may not have been made");
  });
});

describe("the flags of flightdeckd action save, trust and remove (issue #3629)", () => {
  test("each verb takes what it needs: save a file, trust a name and the whole hash, remove a name", () => {
    expect(parseArgs(["action", "save", "--definition-file", "d.json"])).toMatchObject({
      action: "save",
      definitionFile: "d.json",
    });
    expect(parseArgs(["action", "trust", "deploy", "--hash", HASH])).toMatchObject({
      action: "trust",
      actionName: "deploy",
      hash: HASH,
    });
    expect(parseArgs(["action", "remove", "deploy", "--json"])).toMatchObject({
      action: "remove",
      actionName: "deploy",
      json: true,
    });
    expect(() => parseArgs(["action", "save"])).toThrow("missing --definition-file");
    expect(() => parseArgs(["action", "trust", "deploy"])).toThrow("missing --hash");
    expect(() => parseArgs(["action", "trust", "--hash", HASH])).toThrow("the action name");
    expect(() => parseArgs(["action", "remove"])).toThrow("the action name");
  });

  test("a prefix of the hash is refused: the daemon compares the whole sha256", () => {
    expect(() => parseArgs(["action", "trust", "deploy", "--hash", HASH.slice(0, 12)])).toThrow(
      "the 64 hex characters",
    );
    expect(() => parseArgs(["action", "trust", "deploy", "--hash", "z".repeat(64)])).toThrow(
      "--hash",
    );
  });

  test("a flag of another verb is refused, and --secret-ids is a list of ids", () => {
    expect(() => parseArgs(["action", "remove", "deploy", "--hash", HASH])).toThrow(
      "--hash: this flag only applies to flightdeckd action trust",
    );
    expect(() => parseArgs(["action", "list", "--json", "--hash", HASH])).toThrow("--hash: this");
    expect(() =>
      parseArgs(["action", "trust", "deploy", "--hash", HASH, "--definition-file", "d.json"]),
    ).toThrow("--definition-file: this flag only applies to flightdeckd action save");
    expect(() =>
      parseArgs(["action", "trust", "deploy", "--hash", HASH, "--secret-ids", "a"]),
    ).toThrow("--secret-ids: this flag only applies to flightdeckd action save");
    expect(
      parseArgs(["action", "save", "--definition-file", "d.json", "--secret-ids", "a,b"]),
    ).toMatchObject({ secretIds: ["a", "b"] });
    expect(() =>
      parseArgs(["action", "save", "--definition-file", "d.json", "--secret-ids", ","]),
    ).toThrow("--secret-ids");
    // A space after the comma is not part of the id.
    expect(
      parseArgs(["action", "save", "--definition-file", "d.json", "--secret-ids", "a, b"]),
    ).toMatchObject({ secretIds: ["a", "b"] });
  });

  test("--json and --host go with the writes; the persona's --hash is still the persona's", () => {
    expect(
      parseArgs(["action", "trust", "deploy", "--hash", HASH, "--json", "--host", "pi"]),
    ).toMatchObject({ json: true, host: "pi" });
    expect(() => parseArgs(["persona", "list", "--hash", HASH])).toThrow(
      "--hash: this flag only applies to flightdeckd persona trust",
    );
  });
});
