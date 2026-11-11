import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { WatchSettings } from "@flightdeck/protocol";
import { startServer } from "../../src/server.ts";
import { PrWatch } from "../../src/watch/service.ts";
import { PrWatcher } from "../../src/watch/watch.ts";
import { newBoard } from "../support/board-helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

/**
 * Issue #1361 (slice 1b): the check loop's settings live next to the watch's, and the fields that
 * decide what runs unattended change only over a near connection, when their value changes
 * (docs/decisions/2026-11-09-check-loop.md).
 */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const { board, manager, store, root, repo } = newBoard();
  const project = await board.addProject({ path: repo });
  const watcher = new PrWatcher({ db: store.db, board });
  // Only the settings are asked of the service here: no fixer and no trail are reached.
  const watch = new PrWatch({ board, watcher, fixer: {} as never, traces: {} as never });
  const token = "check-loop-settings-token-0123456789";
  const base = {
    manager,
    board,
    watch,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token,
    allowedRoots: [root],
    allowedNetworks: ["0.0.0.0/0", "::/0"],
  };
  const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
  const [near, far] = servers.map((server) => new FrameClient(server.url)) as [
    FrameClient,
    FrameClient,
  ];
  cleanups.push(async () => {
    near.close();
    far.close();
    for (const server of servers) await server.stop();
  });
  for (const client of [near, far]) await client.request("hello", { token, client: "t" });
  /** The settings after the patch, or the refusal's reason. */
  const save = async (client: FrameClient, patch: Record<string, unknown>) => {
    const ack = await client.request("watch.settings", { projectId: project.id, patch });
    const error = ack.error as { reason?: string; code?: string } | undefined;
    return ack.ok === true
      ? (ack.data as Record<string, unknown>)
      : (error?.reason ?? error?.code ?? "refused");
  };
  return { near, far, save, watcher, store, projectId: project.id };
}

describe("check-loop: the loop's settings and who may change them", () => {
  test("a new project has the loop's defaults next to the watch's", async () => {
    const { watcher, projectId } = await setup();
    const settings = watcher.settings(projectId);
    expect([settings.checkRounds, settings.checkEnv, settings.checkLoopDefault]).toEqual([
      3,
      [],
      false,
    ]);
  });

  test("a far client cannot change any field that decides what runs unattended, or as whom, or what may be pushed", async () => {
    const { far, save } = await setup();
    const changes: Array<Record<string, unknown>> = [
      { checks: ["bun test"] },
      { checkTimeoutMin: 20 },
      { checkRounds: 5 },
      { checkEnv: ["JAVA_HOME"] },
      { checkLoopDefault: true },
      { persona: "dev" },
      { driftAllow: ["**"] },
    ];
    const answers = [];
    for (const patch of changes) answers.push(await save(far, patch));
    expect(answers).toEqual(changes.map(() => "transport_refused"));
  });

  test("a far client still saves the whole form when those fields are unchanged, and a near one changes them", async () => {
    const { near, far, save } = await setup();
    const form = {
      enabled: true,
      maxRounds: 4,
      checks: [],
      checkTimeoutMin: 10,
      checkRounds: 3,
      checkEnv: [],
      checkLoopDefault: false,
    };
    const farSaved = await save(far, form);
    const nearSaved = await save(near, {
      checks: ["bun test"],
      checkEnv: ["JAVA_HOME"],
      checkRounds: 2,
    });
    const pick = (value: unknown, keys: string[]) =>
      typeof value === "string"
        ? value
        : Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
    expect([
      pick(farSaved, ["enabled", "maxRounds"]),
      pick(nearSaved, ["checks", "checkEnv", "checkRounds", "enabled"]),
    ]).toEqual([
      { enabled: true, maxRounds: 4 },
      { checks: ["bun test"], checkEnv: ["JAVA_HOME"], checkRounds: 2, enabled: true },
    ]);
  });

  test("a checkEnv stored before the rules is read back without the names they refuse", async () => {
    const { watcher, projectId } = await setup();
    watcher.setSettings(projectId, { checkEnv: ["JAVA_HOME", "LD_PRELOAD", "GIT_SSH_COMMAND"] });
    expect(watcher.settings(projectId).checkEnv).toEqual(["JAVA_HOME"]);
  });

  test("every settings field is classified: only the switch and the spend brakes change from far", async () => {
    const { far, save } = await setup();
    // A value that differs from the default for every field; a new field fails here until it is
    // added, and so until someone decides whether far clients may change it.
    const changed: Record<string, unknown> = {
      enabled: true,
      maxRounds: 5,
      maxTurns: 10,
      maxFailures: 4,
      budgetUsd: 9,
      dailyUsd: 30,
      checks: ["bun test"],
      checkTimeoutMin: 20,
      checkRounds: 5,
      checkEnv: ["JAVA_HOME"],
      checkLoopDefault: true,
      persona: "dev",
      driftAllow: ["**"],
    };
    const farOk = ["enabled", "maxRounds", "maxTurns", "maxFailures", "budgetUsd", "dailyUsd"];
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(changed)) {
      const answer = await save(far, { [key]: value });
      answers[key] = typeof answer === "string" ? answer : "saved";
    }
    expect([Object.keys(changed).sort(), answers]).toEqual([
      Object.keys(WatchSettings.shape).sort(),
      Object.fromEntries(
        Object.keys(changed).map((key) => [
          key,
          farOk.includes(key) ? "saved" : "transport_refused",
        ]),
      ),
    ]);
  });

  test("a stored checkEnv that is not a list reads back as none", async () => {
    const { watcher, projectId, store } = await setup();
    store.db
      .query("INSERT INTO pr_watch_project (project_id, settings) VALUES (?, ?)")
      .run(projectId, JSON.stringify({ checkEnv: "JAVA_HOME" }));
    const read = () => {
      try {
        return watcher.settings(projectId).checkEnv;
      } catch {
        return "the read threw";
      }
    };
    expect(read()).toEqual([]);
  });

  test("checkEnv takes only a toolchain's location names; anything that runs, redirects or looks like a secret is refused", () => {
    const accepts = (names: string[]) =>
      WatchSettings.partial().safeParse({ checkEnv: names }).success;
    const refused = [
      "GIT_SSH_COMMAND",
      "GIT_CONFIG_GLOBAL",
      "GIT_EXTERNAL_DIFF",
      "JAVA_TOOL_OPTIONS",
      "_JAVA_OPTIONS",
      "JDK_JAVA_OPTIONS",
      "MAVEN_OPTS",
      "GRADLE_OPTS",
      "RUBYLIB",
      "PYTHONHOME",
      "NODE_PATH",
      "npm_config_script_shell",
      "RUSTC_WRAPPER",
      "RUSTFLAGS",
      "CC",
      "CXX",
      "SHELL",
      "IFS",
      "PROMPT_COMMAND",
      "COMSPEC",
      "PATHEXT",
      "PSModulePath",
      "SMTP_PASS",
      "PWD",
      "JWT_ISSUER",
      "BEARER",
      "AZURE_SAS",
      "URL_SIGNATURE",
      "WEBHOOK_URL",
      "GITLAB_PAT",
      "GIT_DIR",
      "CLAUDE_HOME",
      "XDG_CONFIG_HOME",
      // Shaped like a location, so only the refused shapes and prefixes stop them: one per term.
      "SECRET_HOME",
      "TOKEN_ROOT",
      "MY_KEY_HOME",
      "DB_PASSWORD_HOME",
      "PASSWD_ROOT",
      "CREDENTIAL_HOME",
      "AUTH_HOME",
      "COOKIE_ROOT",
      "SESSION_HOME",
      "JWT_HOME",
      "BEARER_ROOT",
      "SAS_HOME",
      "SIGNATURE_HOME",
      "WEBHOOK_HOME",
      "SENTRY_DSN_HOME",
      "DB_CONN_ROOT",
      "PRIVATE_ROOT",
      "CERT_HOME",
      "ANTHROPIC_HOME",
      "OPENAI_ROOT",
      "AWS_HOME",
      "AZURE_ROOT",
      "GH_HOME",
      "GITHUB_ROOT",
      "GIT_HOME",
      "NPM_HOME",
      "LD_ROOT",
      "DYLD_HOME",
      "FLIGHTDECK_HOME",
      "flightdeck_home",
    ];
    expect([
      accepts([
        "JAVA_HOME",
        "CARGO_HOME",
        "ANDROID_SDK_ROOT",
        "GOPATH",
        "GOMODCACHE",
        "ProgramFiles(x86)",
      ]),
      refused.filter((name) => accepts([name])),
    ]).toEqual([true, []]);
  });

  test("checkEnv takes variable names only, never one shaped like a secret or Flightdeck's own, in any case", () => {
    const accepts = (names: string[]) =>
      WatchSettings.partial().safeParse({ checkEnv: names }).success;
    expect([
      accepts(["JAVA_HOME", "GOPATH", "ProgramFiles(x86)", "ANDROID_HOME"]),
      accepts(["GITHUB_TOKEN"]),
      accepts(["my_api_key"]),
      accepts(["DB_PASSWORD"]),
      accepts(["AWS_REGION"]),
      accepts(["anthropic_base_url"]),
      accepts(["FLIGHTDECK_X"]),
      accepts(["flightdeck_x"]),
      accepts(["A B"]),
      accepts(["1ABC"]),
      // Credentials hide in connection strings, and loaders run code before the check does.
      ["DATABASE_URL", "SENTRY_DSN", "DB_CONN", "PRIVATE_PEM", "CERT_FILE"].some((n) =>
        accepts([n]),
      ),
      [
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "NODE_OPTIONS",
        "BASH_ENV",
        "ENV",
        "PYTHONSTARTUP",
        "PATH",
      ].some((n) => accepts([n])),
      accepts(Array.from({ length: 21 }, (_, i) => `V${i}`)),
    ]).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
