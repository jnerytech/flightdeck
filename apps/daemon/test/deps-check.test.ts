import { afterEach, describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import { checkDeps, type DepsEnv } from "../src/deps/deps.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOOLS: Record<string, { path: string; version: string }> = {
  claude: { path: "/usr/bin/claude", version: "2.1.0" },
  git: { path: "/usr/bin/git", version: "2.43.0" },
  gh: { path: "/usr/bin/gh", version: "2.60.0" },
  az: { path: "/usr/bin/az", version: "2.65.0" },
  ssh: { path: "/usr/bin/ssh", version: "9.6" },
  tailscale: { path: "/usr/bin/tailscale", version: "1.76.0" },
  systemctl: { path: "/usr/bin/systemctl", version: "255" },
  schtasks: { path: "C:/Windows/System32/schtasks.exe", version: "10.0" },
  pwsh: { path: "C:/Program Files/PowerShell/7/pwsh.exe", version: "7.4.0" },
};

/** A machine with everything in place, with `change` applied on top. */
function machine(
  change: Partial<DepsEnv> & { without?: string[]; versions?: Record<string, string> } = {},
) {
  const { without = [], versions = {}, ...rest } = change;
  const env: DepsEnv = {
    platform: "linux",
    which: (name) => (without.includes(name) ? null : (TOOLS[name]?.path ?? null)),
    version: async (path) => {
      const name = Object.keys(TOOLS).find((n) => TOOLS[n]?.path === path) ?? "";
      return versions[name] ?? TOOLS[name]?.version ?? null;
    },
    allowedRoots: ["/home/dev/code"],
    serviceInstalled: async () => true,
    linger: async () => "on",
    hooks: async () => "installed",
    account: async () => "signed_in",
    ...rest,
  };
  return env;
}

const find = (items: DepResult[], id: string) => items.find((item) => item.id === id) as DepResult;

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
      for (const f of item.fix) expect(f.command.length).toBeGreaterThan(0);
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

const TOKEN = "deps-check-token-0123456789abcdef";
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
});

describe("deps-check: over the protocol", () => {
  const serve = (withDeps: boolean) => {
    const { manager } = newManager();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
      ...(withDeps ? { deps: () => checkDeps(machine({ without: ["gh"] })) } : {}),
    });
    servers.push(server);
    return server;
  };

  test("deps.check answers the items, and the host announces the feature", async () => {
    const client = new FrameClient(serve(true).url);
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("depsCheck");
    const got = await client.data<{ items: DepResult[] }>("deps.check", {});
    expect(find(got?.items ?? [], "gh").state).toBe("missing");
    client.close();
  });

  test("a host without the check refuses the command and does not announce it", async () => {
    const client = new FrameClient(serve(false).url);
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).not.toContain("depsCheck");
    const ack = await client.request("deps.check", {});
    expect(ack.ok).toBe(false);
    client.close();
  });
});
