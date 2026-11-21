import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectCliArgs } from "../../src/cli/domain/project-args.ts";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { parseArgs } from "../../src/main.ts";
import { type ProjectCliArgs, runProjectCli } from "../../src/projects/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);

const folders: string[] = [];
afterEach(async () => {
  await stopAll();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A saved answer on disk, as the person keeps it between two verbs. */
function saved(answer: unknown, raw?: string): string {
  const folder = tempDir("harness-cli-");
  folders.push(folder);
  const file = join(folder, "answer.json");
  writeFileSync(file, raw ?? JSON.stringify(answer));
  return file;
}

/** What the command printed as JSON, or the text when it is none: a wrong print fails an assertion. */
function printed(r: CliResult): unknown {
  try {
    return JSON.parse(r.out.join("\n"));
  } catch {
    return r.out.join("\n");
  }
}
const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);

const preview = (over: Record<string, unknown> = {}) => ({
  settings: {
    path: ".claude/settings.json",
    hash: null,
    hooks: [],
    denyRules: ["Bash(rm:*)"],
    conflicts: [],
    reformats: false,
    digest: "digest-settings",
  },
  files: [{ path: "CLAUDE.md", content: "# api", digest: "digest-claude" }],
  unreadable: [],
  ...over,
});

const apply = (
  file: string,
  over: Partial<Extract<ProjectCliArgs, { action: "harness-apply" }>> = {},
): ProjectCliArgs => ({
  action: "harness-apply",
  path: "/srv/api",
  parts: ["claudeMd", "permissions"],
  digestsFile: file,
  confirm: true,
  ...over,
});

describe("flightdeckd project harness-apply (issue #3515)", () => {
  test("sends the folder, the parts, the digests of the saved preview by path, and the typed confirm", async () => {
    const daemon = fakeDaemon({
      "project.harness.apply": () => ({
        written: [".claude/settings.json", "CLAUDE.md"],
        digests: { "CLAUDE.md": "w1" },
      }),
    });
    const result = await runProjectCli(apply(saved(preview())), config(daemon.port));
    expect(calls(daemon, "project.harness.apply")[0]?.payload).toEqual({
      path: "/srv/api",
      parts: ["claudeMd", "permissions"],
      digests: { ".claude/settings.json": "digest-settings", "CLAUDE.md": "digest-claude" },
      confirm: true,
    });
    expect(result.code).toBe(0);
  });

  test("says which files it wrote, one a line, and keeps the commit's digests for --json", async () => {
    const answer = {
      written: [".claude/settings.json", "CLAUDE.md"],
      digests: { "CLAUDE.md": "w1" },
    };
    const daemon = fakeDaemon({ "project.harness.apply": () => answer });
    const said = await runProjectCli(apply(saved(preview())), config(daemon.port));
    expect(said.out).toEqual(["wrote 2 files", "  .claude/settings.json", "  CLAUDE.md"]);
    const printedAnswer = await runProjectCli(
      apply(saved(preview()), { json: true }),
      config(daemon.port),
    );
    expect(printed(printedAnswer)).toEqual(answer);
  });

  test("passes the template and the reformat the person asked for, and nothing else", async () => {
    const daemon = fakeDaemon({ "project.harness.apply": () => ({ written: [] }) });
    await runProjectCli(
      apply(saved(preview()), { template: "web", reformat: true }),
      config(daemon.port),
    );
    expect(calls(daemon, "project.harness.apply")[0]?.payload).toMatchObject({
      template: "web",
      reformat: true,
    });
  });

  test("makes a relative folder absolute, as the other verbs do", async () => {
    const daemon = fakeDaemon({ "project.harness.apply": () => ({ written: [] }) });
    await runProjectCli(apply(saved(preview()), { path: "api" }), config(daemon.port));
    expect(calls(daemon, "project.harness.apply")[0]?.payload.path).toBe(resolve("api"));
  });

  test("refuses a file that is missing, is not JSON, or is no preview, and calls nothing", async () => {
    const daemon = fakeDaemon({ "project.harness.apply": () => ({ written: [] }) });
    const missing = await runProjectCli(apply("/nowhere/preview.json"), config(daemon.port));
    const notJson = await runProjectCli(apply(saved(null, "{nope")), config(daemon.port));
    const notPreview = await runProjectCli(
      apply(saved({ written: ["CLAUDE.md"] })),
      config(daemon.port),
    );
    expect([missing.code, notJson.code, notPreview.code]).toEqual([1, 1, 1]);
    expect(text(missing)).toContain("/nowhere/preview.json");
    expect(text(notJson)).toContain("not JSON");
    expect(text(notPreview)).toContain("harness-preview --json");
    expect(calls(daemon, "project.harness.apply")).toEqual([]);
  });

  test("refuses a preview that proposes nothing, and one with more digests than the protocol takes", async () => {
    const daemon = fakeDaemon({ "project.harness.apply": () => ({ written: [] }) });
    const nothing = await runProjectCli(
      apply(saved(preview({ settings: null, files: [] }))),
      config(daemon.port),
    );
    const files = Array.from({ length: 17 }, (_, i) => ({
      path: `skills/s${i}/SKILL.md`,
      content: "x",
      digest: `d${i}`,
    }));
    const tooMany = await runProjectCli(apply(saved(preview({ files }))), config(daemon.port));
    expect([nothing.code, tooMany.code]).toEqual([1, 1]);
    expect(text(nothing)).toContain("nothing to apply");
    expect(text(tooMany)).toContain("17");
    expect(calls(daemon, "project.harness.apply")).toEqual([]);
  });

  test("a host with a device enrolled wants that device's signature: says the person does it in the app, exit 1", async () => {
    const daemon = fakeDaemon({
      "project.harness.apply": () => ({
        error: {
          code: "invalid_state",
          message: "the request needs the signature of an enrolled device",
          reason: "approval_proof_required",
        },
      }),
    });
    const result = await runProjectCli(apply(saved(preview())), config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("do it in the app");
    expect(text(result)).not.toContain("signature of an enrolled device");
  });

  test("a stale digest, and a folder that is another folder, exit 1 with the daemon's own text", async () => {
    for (const [reason, message] of [
      ["harness_stale", "the project changed since the preview"],
      ["harness_path_differs", "the folder is another one than the folder named"],
    ] as const) {
      const daemon = fakeDaemon({
        "project.harness.apply": () => ({ error: { code: "invalid_state", message, reason } }),
      });
      const result = await runProjectCli(apply(saved(preview())), config(daemon.port));
      expect([result.code, text(result)]).toEqual([1, expect.stringContaining(message)]);
    }
  });

  test("a layout change the person did not accept points at --reformat, not at the protocol's field", async () => {
    const daemon = fakeDaemon({
      "project.harness.apply": () => ({
        error: {
          code: "invalid_state",
          message:
            "writing the settings back would change their layout: confirm with reformat: true",
          reason: "harness_reformat",
        },
      }),
    });
    const result = await runProjectCli(apply(saved(preview())), config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("--reformat");
  });

  test("an apply that got no answer exits 2 and says it may or may not have happened", async () => {
    const silent = fakeDaemon({});
    const result = await runProjectCli(apply(saved(preview())), config(silent.port), {
      timeoutMs: 200,
    });
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have happened");
  });
});

const commit = (
  file: string,
  over: Partial<Extract<ProjectCliArgs, { action: "harness-commit" }>> = {},
): ProjectCliArgs => ({
  action: "harness-commit",
  path: "/srv/api",
  digestsFile: file,
  confirm: true,
  ...over,
});

describe("flightdeckd project harness-commit (issue #3515)", () => {
  test("sends the digests the apply answered and the typed confirm, and says the branch and the commit", async () => {
    const daemon = fakeDaemon({
      "project.harness.commit": () => ({
        branch: "flightdeck/setup-1",
        commit: "0123456789abcdef0123456789abcdef01234567",
        files: [".claude/settings.json", "CLAUDE.md"],
      }),
    });
    const answered = { written: ["CLAUDE.md"], digests: { "CLAUDE.md": "w1" } };
    const result = await runProjectCli(commit(saved(answered)), config(daemon.port));
    expect(calls(daemon, "project.harness.commit")[0]?.payload).toEqual({
      path: "/srv/api",
      digests: { "CLAUDE.md": "w1" },
      confirm: true,
    });
    expect(result.out).toEqual([
      "committed 2 files on flightdeck/setup-1  0123456789ab",
      "  .claude/settings.json",
      "  CLAUDE.md",
    ]);
  });

  test("--json prints the daemon's answer", async () => {
    const answer = { branch: "b", commit: "c", files: ["CLAUDE.md"] };
    const daemon = fakeDaemon({ "project.harness.commit": () => answer });
    const result = await runProjectCli(
      commit(saved({ written: [], digests: { "CLAUDE.md": "w1" } }), { json: true }),
      config(daemon.port),
    );
    expect(printed(result)).toEqual(answer);
  });

  test("refuses an answer with no digests (an apply from an older host, or a preview), and calls nothing", async () => {
    const daemon = fakeDaemon({ "project.harness.commit": () => ({}) });
    const none = await runProjectCli(
      commit(saved({ written: ["CLAUDE.md"] })),
      config(daemon.port),
    );
    const empty = await runProjectCli(
      commit(saved({ written: [], digests: {} })),
      config(daemon.port),
    );
    const preview1 = await runProjectCli(commit(saved(preview())), config(daemon.port));
    expect([none.code, empty.code, preview1.code]).toEqual([1, 1, 1]);
    expect(text(none)).toContain("harness-apply --json");
    expect(calls(daemon, "project.harness.commit")).toEqual([]);
  });

  test("refuses more digests than the protocol takes, and a file that is not JSON", async () => {
    const daemon = fakeDaemon({ "project.harness.commit": () => ({}) });
    const digests = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`f${i}`, `d${i}`]));
    const many = await runProjectCli(commit(saved({ written: [], digests })), config(daemon.port));
    const notJson = await runProjectCli(commit(saved(null, "{nope")), config(daemon.port));
    expect([many.code, notJson.code]).toEqual([1, 1]);
    expect(text(many)).toContain("17");
    expect(calls(daemon, "project.harness.commit")).toEqual([]);
  });

  test("a commit the daemon refuses exits 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "project.harness.commit": () => ({
        error: {
          code: "invalid_state",
          message: "a file changed since it was written",
          reason: "harness_commit_stale",
        },
      }),
    });
    const result = await runProjectCli(
      commit(saved({ written: [], digests: { "CLAUDE.md": "w1" } })),
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("a file changed since it was written");
  });
});

/** The parser appends the usage text, which names every flag: the refusal is the line before it. */
const firstLine = (error: unknown) => (error as Error).message.split("\n")[0];
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: firstLine(error) };
  }
}
/** What the runner would take, or what the parser refused with. */
function runnerArgs(argv: string[]): unknown {
  try {
    return projectCliArgs(parseArgs(argv));
  } catch (error) {
    return { refusedWith: firstLine(error) };
  }
}
const refusedWith = (argv: string[], word: string) =>
  expect(parsed(argv)).toMatchObject({ refusedWith: expect.stringContaining(word) });

describe("flightdeckd project harness-apply and harness-commit: the words (issue #3515)", () => {
  test("apply takes the folder, the parts, the saved preview and the confirm, and hands them to the runner", () => {
    const argv = [
      "project",
      "harness-apply",
      "/srv/api",
      "--parts",
      "claudeMd,hooks",
      "--digests",
      "preview.json",
      "--confirm",
      "--json",
    ];
    expect(parsed(argv)).toMatchObject({
      action: "harness-apply",
      projectPaths: ["/srv/api"],
      projectParts: ["claudeMd", "hooks"],
      projectDigests: "preview.json",
      confirm: true,
    });
    expect(runnerArgs(argv)).toEqual({
      action: "harness-apply",
      path: "/srv/api",
      parts: ["claudeMd", "hooks"],
      digestsFile: "preview.json",
      confirm: true,
      json: true,
    });
  });

  test("apply also takes --template and --reformat; commit takes the folder, the saved apply and the confirm", () => {
    expect(
      runnerArgs([
        "project",
        "harness-apply",
        "/srv/api",
        "--parts",
        "skills",
        "--digests",
        "p.json",
        "--template",
        "web",
        "--reformat",
        "--confirm",
      ]),
    ).toMatchObject({ template: "web", reformat: true });
    expect(
      runnerArgs(["project", "harness-commit", "/srv/api", "--digests", "a.json", "--confirm"]),
    ).toEqual({
      action: "harness-commit",
      path: "/srv/api",
      digestsFile: "a.json",
      confirm: true,
    });
  });

  test("both are refused without the typed --confirm, and without the file of digests", () => {
    refusedWith(
      ["project", "harness-apply", "/a", "--parts", "claudeMd", "--digests", "p.json"],
      "--confirm",
    );
    refusedWith(["project", "harness-commit", "/a", "--digests", "a.json"], "--confirm");
    refusedWith(
      ["project", "harness-apply", "/a", "--parts", "claudeMd", "--confirm"],
      "--digests",
    );
    refusedWith(["project", "harness-commit", "/a", "--confirm"], "--digests");
  });

  test("apply is refused without --parts, with a part that is none, and with two folders", () => {
    refusedWith(["project", "harness-apply", "/a", "--digests", "p.json", "--confirm"], "--parts");
    refusedWith(
      [
        "project",
        "harness-apply",
        "/a",
        "--parts",
        "everything",
        "--digests",
        "p.json",
        "--confirm",
      ],
      "--parts",
    );
    refusedWith(
      [
        "project",
        "harness-apply",
        "/a",
        "/b",
        "--parts",
        "hooks",
        "--digests",
        "p.json",
        "--confirm",
      ],
      "one folder",
    );
  });

  test("a flag outside the verbs that take it is refused, and --confirm stays the other nouns' flag", () => {
    refusedWith(
      ["project", "harness-commit", "/a", "--digests", "a.json", "--confirm", "--reformat"],
      "--reformat",
    );
    refusedWith(
      ["project", "harness-commit", "/a", "--digests", "a.json", "--confirm", "--parts", "hooks"],
      "--parts",
    );
    refusedWith(
      ["project", "harness-preview", "/a", "--parts", "hooks", "--digests", "p.json"],
      "--digests",
    );
    refusedWith(["project", "stack", "/a", "--confirm"], "--confirm");
    expect(parsed(["rules", "remove", "r1", "--confirm"])).toMatchObject({ confirm: true });
  });
});
