import { describe, expect, test } from "bun:test";
import { checkDeps, type DepsEnv } from "../../src/deps/domain/deps.ts";
import { find, machine, TOOLS } from "./check-fixtures.ts";

describe("deps-check: the dependencies of a host", () => {
  test("a host with everything in place has five required and six optional, each ok or not applicable", async () => {
    const { items } = await checkDeps(machine());
    expect(items.filter((i) => i.group === "required").map((i) => i.id)).toEqual([
      "claude",
      "claudeAuth",
      "git",
      "service",
      "folders",
    ]);
    expect(items.filter((i) => i.group === "optional").map((i) => i.id)).toEqual([
      "gh",
      "az",
      "ssh",
      "tailscale",
      "pwsh",
      "hooks",
    ]);
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ["claude", "ok"],
      ["claudeAuth", "ok"],
      ["git", "ok"],
      ["service", "ok"],
      ["folders", "ok"],
      ["gh", "ok"],
      ["az", "ok"],
      ["ssh", "ok"],
      ["tailscale", "ok"],
      ["pwsh", "na"],
      ["hooks", "ok"],
    ]);
    expect(find(items, "git")).toMatchObject({ version: "2.43.0", path: "/usr/bin/git" });
  });

  test("a missing tool is missing, in its group, with what stops working and how to install it per OS", async () => {
    const { items } = await checkDeps(machine({ without: ["claude", "gh"] }));
    expect(find(items, "claude")).toMatchObject({
      group: "required",
      state: "missing",
      breaks: ["sessions"],
    });
    expect(find(items, "gh")).toMatchObject({
      group: "optional",
      state: "missing",
      breaks: ["github", "pullRequests", "boardSync"],
    });
    for (const item of [find(items, "claude"), find(items, "gh")]) {
      expect(item.fix.map((f) => f.os).sort()).toEqual(["darwin", "linux", "win32"]);
      for (const f of item.fix) expect((f.command ?? f.url ?? "").length).toBeGreaterThan(0);
    }
    expect(find(items, "gh").fix.find((f) => f.os === "win32")?.command).toContain("winget");
  });

  test("Claude Code signed in: signed out is missing with the sign-in command; an API key or a third party is fine; unknown or no claude is not applicable", async () => {
    const row = async (env: Parameters<typeof machine>[0]) =>
      find((await checkDeps(machine(env))).items, "claudeAuth");
    expect(await row({})).toMatchObject({ group: "required", state: "ok" });
    expect(await row({ account: async () => "api_key" })).toMatchObject({ state: "ok" });
    expect(await row({ account: async () => "third_party" })).toMatchObject({ state: "ok" });
    const out = await row({ account: async () => "signed_out" });
    expect(out).toMatchObject({ state: "missing", breaks: ["sessions"] });
    expect(out.fix.every((f) => f.command === "claude auth login")).toBe(true);
    expect(out.fix.map((f) => f.os).sort()).toEqual(["darwin", "linux", "win32"]);
    expect((await row({ account: async () => "unknown" })).state).toBe("na");
    expect((await row({ account: async () => null })).state).toBe("na");
    // Nothing to sign in to without claude: the missing claude is the problem, said once.
    expect((await row({ without: ["claude"], account: async () => "signed_out" })).state).toBe(
      "na",
    );
  });

  test("a git too old for worktrees is outdated, with the least version that works", async () => {
    const { items } = await checkDeps(machine({ versions: { git: "2.3.1" } }));
    expect(find(items, "git")).toMatchObject({
      state: "outdated",
      version: "2.3.1",
      minVersion: "2.5.0",
      breaks: ["projects", "worktrees", "changes", "board"],
    });
    expect(
      (await checkDeps(machine({ versions: { git: "2.5.0" } }))).items.find((i) => i.id === "git")
        ?.state,
    ).toBe("ok");
  });

  test("the service: on Linux it needs systemd, the unit and linger; on Windows the scheduled task", async () => {
    const linux = async (env: Partial<DepsEnv> & { without?: string[] }) =>
      find((await checkDeps(machine(env))).items, "service");
    expect((await linux({})).state).toBe("ok");
    expect(await linux({ linger: async () => "off" })).toMatchObject({
      state: "missing",
      breaks: ["autostart"],
    });
    expect((await linux({ serviceInstalled: async () => false })).state).toBe("missing");
    expect((await linux({ without: ["systemctl"] })).state).toBe("missing");
    const win = find(
      (
        await checkDeps(
          machine({
            platform: "win32",
            linger: async () => null,
            serviceInstalled: async () => false,
          }),
        )
      ).items,
      "service",
    );
    expect(win.state).toBe("missing");
    const winOk = find(
      (
        await checkDeps(
          machine({
            platform: "win32",
            linger: async () => null,
            which: (n) => (n === "schtasks" ? (TOOLS.schtasks?.path ?? null) : null),
          }),
        )
      ).items,
      "service",
    );
    expect(winOk.state).toBe("ok");
    expect(find((await checkDeps(machine({ platform: "darwin" }))).items, "service").state).toBe(
      "na",
    );
  });

  test("allowed folders: none is missing, and nothing can start without one", async () => {
    const { items } = await checkDeps(machine({ allowedRoots: [] }));
    expect(find(items, "folders")).toMatchObject({
      group: "required",
      state: "missing",
      breaks: ["sessions", "projects"],
    });
    expect(find(items, "folders").fix[0]?.command).toContain("flightdeckd setup");
  });

  test("PowerShell applies only on Windows; the hooks can be absent or out of date", async () => {
    const win = await checkDeps(machine({ platform: "win32", linger: async () => null }));
    expect(find(win.items, "pwsh")).toMatchObject({ state: "ok", version: "7.4.0" });
    const winNo = await checkDeps(machine({ platform: "win32", without: ["pwsh"] }));
    expect(find(winNo.items, "pwsh")).toMatchObject({ state: "missing", breaks: ["windowsSetup"] });
    expect(
      find((await checkDeps(machine({ hooks: async () => "outdated" }))).items, "hooks"),
    ).toMatchObject({
      state: "outdated",
      breaks: ["liveStatus"],
    });
    expect(
      find((await checkDeps(machine({ hooks: async () => "absent" }))).items, "hooks").state,
    ).toBe("missing");
  });
});

describe("deps-check: probes that fail or overlap", () => {
  test("a probe that throws gives its own row without a version and the other rows still come back (HD-M1)", async () => {
    const base = machine();
    const { items } = await checkDeps({
      ...base,
      version: async (path) => {
        if (path === TOOLS.git?.path) throw new Error("spawn ENOEXEC");
        return base.version(path);
      },
    });
    expect(items).toHaveLength(11);
    expect(find(items, "git")).toMatchObject({ state: "ok", path: TOOLS.git?.path });
    expect(find(items, "git").version).toBeUndefined();
    expect(find(items, "claude")).toMatchObject({ state: "ok", version: "2.1.0" });
  });

  test("the programs are probed at the same time, so a slow one costs its own time only", async () => {
    const base = machine();
    let running = 0;
    let most = 0;
    await checkDeps({
      ...base,
      version: async (path) => {
        running++;
        most = Math.max(most, running);
        // timing: a slow answer on purpose, so that two calls overlap
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return base.version(path);
      },
    });
    expect(most).toBeGreaterThanOrEqual(5);
  });

  test("on a platform without a service manager the service row is not applicable and the manager is never asked (HD-M5)", async () => {
    let asked = 0;
    const { items } = await checkDeps(
      machine({
        platform: "darwin",
        serviceInstalled: async () => {
          asked++;
          throw new Error("installing as a service is not supported on darwin");
        },
      }),
    );
    expect(find(items, "service")).toMatchObject({ state: "na" });
    expect(asked).toBe(0);
    expect(items).toHaveLength(11);
  });
});

describe("deps-check: a probe that cannot run", () => {
  test("a PowerShell whose version cannot be read is still found, without a version", async () => {
    const base = machine({ platform: "win32" });
    const { items } = await checkDeps({
      ...base,
      version: async (path) => {
        if (path.includes("pwsh")) throw new Error("spawn failed");
        return base.version(path);
      },
    });
    const pwsh = find(items, "pwsh");
    expect(pwsh.state).toBe("ok");
    expect(pwsh.version).toBeUndefined();
  });
});
