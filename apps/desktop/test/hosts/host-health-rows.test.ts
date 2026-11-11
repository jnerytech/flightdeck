import { describe, expect, test } from "bun:test";
import type { DepResult, DoctorCheckResult } from "@flightdeck/protocol";
import {
  checkRow,
  depRow,
  type HealthRow,
  headlineFor,
  healthCounts,
  needsYou,
  type RowEnv,
  uncoveredChecks,
} from "../../src/features/hosts/host-health-rows.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

const dep = (
  id: DepResult["id"],
  group: DepResult["group"],
  state: DepResult["state"],
  extra: Partial<DepResult> = {},
): DepResult => ({
  id,
  group,
  state,
  breaks: [],
  fix: [{ os: "linux", command: `sudo apt install ${id}` }],
  ...extra,
});

const check = (
  id: DoctorCheckResult["id"],
  status: DoctorCheckResult["status"],
  extra: Partial<DoctorCheckResult> = {},
): DoctorCheckResult => ({ id, status, detail: `${id} detail`, ...extra });

function env(over: Partial<RowEnv> = {}) {
  const calls: string[] = [];
  const full: RowEnv = {
    t,
    os: "linux",
    update: null,
    onAddFolder: () => void calls.push("folder"),
    confirm: (what) => void calls.push(`confirm:${what}`),
    canInstallService: false,
    ...over,
  };
  return { env: full, calls };
}

describe("host-health-rows: a dependency row", () => {
  test("a working dependency shows its version and path and offers nothing to fix", () => {
    const { env: e } = env();
    const row = depRow(dep("git", "required", "ok", { version: "2.5.1", path: "/usr/bin/git" }), e);
    expect(row.key).toBe("git");
    expect(row.look).toEqual({ icon: "check", tone: "ok" });
    expect(row.word).toBe(t("hostDeps.state.ok"));
    expect(row.found).toEqual([t("hostDeps.version", { version: "2.5.1" }), "/usr/bin/git"]);
    expect([row.breaks, row.copy, row.page, row.step, row.action]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("an outdated one names the least version and what stops working, and gives the command to copy", () => {
    const { env: e } = env();
    const row = depRow(
      dep("git", "required", "outdated", {
        version: "2.3.1",
        minVersion: "2.5.0",
        breaks: ["projects", "worktrees"],
      }),
      e,
    );
    expect(row.look).toEqual({ icon: "warning", tone: "warn" });
    expect(row.found).toEqual([
      t("hostDeps.version", { version: "2.3.1" }),
      t("hostDeps.minVersion", { version: "2.5.0" }),
    ]);
    expect(row.breaks).toBe(
      t("hostDeps.without", {
        features: [t("hostDeps.breaks.projects"), t("hostDeps.breaks.worktrees")].join(", "),
      }),
    );
    expect(row.copy).toBe("sudo apt install git");
  });

  test("a missing dependency links its official page and words the note for its OS", () => {
    const { env: e } = env();
    const row = depRow(
      dep("git", "required", "missing", {
        fix: [
          {
            os: "linux",
            command: "sudo apt install git",
            url: "https://git-scm.com/downloads",
            note: "elevated",
          },
        ],
      }),
      e,
    );
    expect(row.page).toBe("https://git-scm.com/downloads");
    expect(row.step).toBe(t("hostDeps.fixNote.elevated"));
    const other = depRow(dep("git", "required", "missing"), e);
    expect([other.page, other.step]).toEqual([null, null]);
  });

  test("hooks and folders offer a one-click fix that asks or goes to the folders", () => {
    const { env: e, calls } = env();
    const hooks = depRow(dep("hooks", "required", "missing"), e);
    expect(hooks.action?.label).toBe(t("hostPage.install"));
    hooks.action?.run();
    const folders = depRow(dep("folders", "required", "missing"), e);
    expect(folders.action?.label).toBe(t("hostHealth.addFolder"));
    folders.action?.run();
    expect(calls).toEqual(["confirm:hooks", "folder"]);
  });

  test("the service installs from here only when the host can and the fix is the install command", () => {
    const install = dep("service", "required", "missing", {
      fix: [{ os: "linux", command: "flightdeckd service install" }],
    });
    const can = env({ canInstallService: true });
    const row = depRow(install, can.env);
    expect(row.action?.label).toBe(t("hostHealth.service.turnOn"));
    row.action?.run();
    expect(can.calls).toEqual(["confirm:service"]);
    expect(depRow(install, env().env).action).toBeNull();
    const other = dep("service", "required", "missing");
    expect(depRow(other, can.env).action).toBeNull();
  });

  test("a dependency that is not missing or outdated offers no fix, even a service the host can install", () => {
    const { env: e } = env({ canInstallService: true });
    const row = depRow(
      dep("service", "required", "ok", {
        fix: [{ os: "linux", command: "flightdeckd service install" }],
      }),
      e,
    );
    expect([row.copy, row.page, row.step, row.action]).toEqual([null, null, null, null]);
  });
});

describe("host-health-rows: a doctor check row", () => {
  test("a check that passed has no step and no action", () => {
    const row = checkRow(check("claude", "ok"), env().env);
    expect(row.look).toEqual({ icon: "check", tone: "ok" });
    expect(row.word).toBe(t("hostDeps.state.ok"));
    expect(row.found).toEqual(["claude detail"]);
    expect([row.step, row.action]).toEqual([null, null]);
  });

  test("a warning or a failure gives the step to take, and a failed version offers the update", () => {
    const warn = checkRow(check("hooks", "warn"), env().env);
    expect(warn.look).toEqual({ icon: "warning", tone: "warn" });
    expect(warn.word).toBe(t("hostHealth.warning"));
    expect(warn.step).toBe(t("doctor.fix", { step: t("doctor.steps.hooks") }));
    const { env: e, calls } = env({ update: "9.9.9" });
    const version = checkRow(check("version", "fail"), e);
    expect(version.look).toEqual({ icon: "cross", tone: "error" });
    expect(version.word).toBe(t("hostHealth.failed"));
    expect(version.action?.label).toBe(t("daemonUpdate.button", { version: "9.9.9" }));
    version.action?.run();
    expect(calls).toEqual(["confirm:update"]);
    expect(checkRow(check("version", "fail"), env().env).action).toBeNull();
  });

  test("an optional tool that is not installed is muted, not OK", () => {
    const row = checkRow(check("claude", "ok", { absent: true }), env().env);
    expect(row.look).toEqual({ icon: "dash", tone: "off" });
    expect(row.word).toBe(t("hostHealth.optionalAbsent"));
  });
});

describe("host-health-rows: the headline", () => {
  const base = { error: null, read: true, required: 0, optional: 0 };

  test("a failed read says why, before anything else", () => {
    expect(headlineFor({ ...base, error: "offline", required: 3 }, t)).toEqual({
      text: t("hostDeps.readFailed", { reason: "offline" }),
      look: { icon: "warning", tone: "warn" },
    });
  });

  test("until the first read it says it is checking", () => {
    expect(headlineFor({ ...base, read: false }, t)).toEqual({
      text: t("hostDeps.checking"),
      look: { icon: "dash", tone: "off" },
    });
  });

  test("required missing is red and wins over optional; optional missing is amber; else all set", () => {
    expect(headlineFor({ ...base, required: 2, optional: 5 }, t)).toEqual({
      text: t("hostDeps.requiredMissing", { n: 2 }),
      look: { icon: "cross", tone: "error" },
    });
    expect(headlineFor({ ...base, optional: 1 }, t)).toEqual({
      text: t("hostDeps.optionalMissing", { n: 1 }),
      look: { icon: "warning", tone: "warn" },
    });
    expect(headlineFor(base, t)).toEqual({
      text: t("hostDeps.allSet"),
      look: { icon: "check", tone: "ok" },
    });
  });
});

describe("host-health-rows: which checks and counts the section shows", () => {
  test("a check a dependency already says is shown once, as the dependency", () => {
    const items = [dep("claude", "required", "ok"), dep("service", "required", "ok")];
    const checks = [
      check("claude", "ok"),
      check("linger", "warn"),
      check("hooks", "ok"),
      check("version", "ok"),
    ];
    expect(uncoveredChecks(checks, items).map((c) => c.id)).toEqual(["hooks", "version"]);
    expect(uncoveredChecks(checks, []).map((c) => c.id)).toEqual([
      "claude",
      "linger",
      "hooks",
      "version",
    ]);
  });

  test("the counts add the failing and warning checks to what the dependencies are missing", () => {
    const items = [dep("git", "required", "missing"), dep("gh", "optional", "missing")];
    expect(
      healthCounts(items, [check("claude", "fail"), check("hooks", "warn"), check("daemon", "ok")]),
    ).toEqual({ required: 2, optional: 1 });
    expect(healthCounts([dep("gh", "optional", "missing")], [check("hooks", "warn")])).toEqual({
      required: 0,
      optional: 2,
    });
    expect(healthCounts([], [])).toEqual({ required: 0, optional: 0 });
  });

  test("only a warning or an error row needs the person", () => {
    const row = (tone: HealthRow["look"]["tone"]): Pick<HealthRow, "look"> => ({
      look: { icon: "check", tone },
    });
    const tones: HealthRow["look"]["tone"][] = ["ok", "warn", "error", "off"];
    expect(tones.map((tone) => needsYou(row(tone)))).toEqual([false, true, true, false]);
  });
});
