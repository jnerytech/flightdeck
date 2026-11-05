import { describe, expect, test } from "bun:test";
import type { DepResult } from "@flightdeck/protocol";
import {
  missingTools,
  SETUP_HIDDEN_KEY,
  SETUP_NOTIFIED_KEY,
  SETUP_TOOLS_KEY,
  type SetupInput,
  type SetupProbe,
  SetupSettings,
  type SetupStep,
  setupProgress,
  setupSteps,
} from "../src/lib/setup-steps.ts";
import type { Platform } from "../src/platform/types.ts";

const FEATURES = ["central", "workflows", "github", "costs"];
const host = (id: string, over: object = {}) => ({
  id,
  name: id,
  status: "online",
  hostInfo: { daemonVersion: "x", features: FEATURES },
  sessions: [],
  ...over,
});
const probe = (over: Partial<SetupProbe> = {}): SetupProbe => ({
  hooks: null,
  github: null,
  ...over,
});
const input = (over: Partial<SetupInput> = {}): SetupInput =>
  ({
    hosts: [],
    projects: {},
    cards: {},
    hub: {},
    budgets: {},
    externals: {},
    probes: {},
    notified: false,
    ...over,
  }) as unknown as SetupInput;
const stepOf = (steps: SetupStep[], id: string) => steps.find((s) => s.id === id);
const ids = (steps: SetupStep[]) => steps.map((s) => s.id);
const done = (steps: SetupStep[]) => steps.filter((s) => s.done).map((s) => s.id);
const project = (over: object = {}) => ({
  id: "p",
  name: "api",
  path: "/work/api",
  baseBranch: "main",
  worktreeInclude: false,
  ...over,
});

describe("setup-steps: derived from the real state (issue #164)", () => {
  test("a fresh app: four core steps, none done, and optional ones to follow", () => {
    const steps = setupSteps(input());
    expect(ids(steps.filter((s) => s.core))).toEqual(["host", "hooks", "project", "session"]);
    expect(done(steps)).toEqual([]);
    expect(setupProgress(steps)).toEqual({ done: 0, total: 4, complete: false });
  });

  test("a host online is the first step; losing it takes it back", () => {
    const withHost = setupSteps(input({ hosts: [host("h1")] as never }));
    expect(done(withHost)).toEqual(["host"]);
    expect(setupProgress(withHost)).toMatchObject({ done: 1, total: 4 });
    const offline = setupSteps(input({ hosts: [host("h1", { status: "offline" })] as never }));
    expect(done(offline)).toEqual([]);
    expect(done(setupSteps(input()))).toEqual([]);
  });

  test("hooks count only when the host says they are installed", () => {
    const base = { hosts: [host("h1")] as never };
    const of = (hooks: SetupProbe["hooks"]) =>
      done(setupSteps(input({ ...base, probes: { h1: probe({ hooks }) } })));
    expect(of("installed")).toContain("hooks");
    expect(of("outdated")).not.toContain("hooks");
    expect(of("absent")).not.toContain("hooks");
    expect(of(null)).not.toContain("hooks");
  });

  test("a project counts when it has a base branch", () => {
    const base = { hosts: [host("h1")] as never };
    expect(done(setupSteps(input({ ...base, projects: { h1: [project()] } as never })))).toContain(
      "project",
    );
    expect(
      done(
        setupSteps(input({ ...base, projects: { h1: [project({ baseBranch: "" })] } as never })),
      ),
    ).not.toContain("project");
    expect(done(setupSteps(input({ ...base, projects: { h1: [] } as never })))).not.toContain(
      "project",
    );
  });

  test("a first session is any session, terminal session, listed session or started card", () => {
    const base = { hosts: [host("h1")] as never };
    const has = (over: Partial<SetupInput>) =>
      done(setupSteps(input({ ...base, ...over }))).includes("session");
    expect(has({})).toBe(false);
    expect(has({ hosts: [host("h1", { sessions: [{ id: "s", status: "idle" }] })] as never })).toBe(
      true,
    );
    expect(has({ externals: { "h1/e": { claudeSessionId: "e" } } as never })).toBe(true);
    expect(has({ hub: { h1: { managed: [{ id: "m" }], history: [] } } as never })).toBe(true);
    expect(
      has({ hub: { h1: { managed: [], history: [{ claudeSessionId: "x" }] } } as never }),
    ).toBe(true);
    expect(has({ cards: { "h1/c": { id: "c", sessionId: "s" } } as never })).toBe(true);
    expect(has({ cards: { "h1/c": { id: "c", sessionId: null } } as never })).toBe(false);
  });

  test("the optional steps read GitHub, the test notification, the budgets and .worktreeinclude", () => {
    const base = { hosts: [host("h1")] as never };
    const of = (over: Partial<SetupInput>) => done(setupSteps(input({ ...base, ...over })));
    expect(of({})).not.toContain("github");
    expect(of({ probes: { h1: probe({ github: true }) } })).toContain("github");
    expect(of({ probes: { h1: probe({ github: false }) } })).not.toContain("github");
    expect(of({ notified: true })).toContain("notifications");
    expect(of({ budgets: { h1: [{ id: "b" }] } as never })).toContain("budget");
    expect(of({ budgets: { h1: [] } as never })).not.toContain("budget");
    expect(of({ projects: { h1: [project({ worktreeInclude: true })] } as never })).toContain(
      "worktreeinclude",
    );
    expect(of({ projects: { h1: [project()] } as never })).not.toContain("worktreeinclude");
  });

  test("a host that does not announce a feature leaves that step out instead of blocking", () => {
    const bare = host("h1", { hostInfo: { daemonVersion: "x", features: [] } });
    const steps = setupSteps(input({ hosts: [bare] as never }));
    expect(ids(steps)).toEqual(["host", "session", "notifications"]);
    expect(setupProgress(steps)).toEqual({ done: 1, total: 2, complete: false });
    // With no host at all nothing is known yet: the steps that need a feature stay.
    expect(ids(setupSteps(input()))).toContain("hooks");
    // The worktreeinclude step needs a project to look at.
    expect(ids(setupSteps(input({ hosts: [host("h1")] as never })))).not.toContain(
      "worktreeinclude",
    );
  });

  test("the core steps done make it complete, whatever the optional ones say", () => {
    const steps = setupSteps(
      input({
        hosts: [host("h1", { sessions: [{ id: "s", status: "idle" }] })] as never,
        projects: { h1: [project()] } as never,
        probes: { h1: probe({ hooks: "installed" }) },
      }),
    );
    expect(setupProgress(steps)).toEqual({ done: 4, total: 4, complete: true });
    expect(done(steps)).not.toContain("github");
  });

  test("each step's action leads to the screen where it is fixed", () => {
    const with1 = setupSteps(input({ hosts: [host("h1")] as never }));
    expect(stepOf(with1, "host")?.route).toEqual({ name: "add-host" });
    expect(stepOf(with1, "hooks")?.route).toEqual({ name: "host", host: "h1" });
    expect(stepOf(with1, "project")?.route).toEqual({ name: "projects", host: "h1" });
    expect(stepOf(with1, "session")?.route).toEqual({ name: "new-session", host: "h1" });
    expect(stepOf(with1, "github")?.route).toEqual({ name: "host", host: "h1" });
    expect(stepOf(with1, "notifications")?.route).toEqual({ name: "settings" });
    expect(stepOf(with1, "budget")?.route).toEqual({ name: "settings" });
    const none = setupSteps(input());
    expect(stepOf(none, "hooks")?.route).toEqual({ name: "add-host" });
    expect(stepOf(none, "session")?.route).toEqual({ name: "add-host" });
  });
});

const dep = (id: string, group: DepResult["group"], state: DepResult["state"]): DepResult =>
  ({ id, group, state, breaks: [], fix: [] }) as unknown as DepResult;

describe("setup-steps: missing tools get a quiet card (issue #164)", () => {
  test("what is missing, required first; what is there or does not apply is left out", () => {
    const found = missingTools({
      items: [
        dep("gh", "optional", "missing"),
        dep("claude", "required", "missing"),
        dep("git", "required", "ok"),
        dep("ssh", "optional", "na"),
        dep("tailscale", "optional", "outdated"),
      ],
    });
    expect(found.map((d) => d.id)).toEqual(["claude", "gh"]);
    expect(missingTools(undefined)).toEqual([]);
    expect(missingTools({ items: [] })).toEqual([]);
  });
});

describe("setup-steps: what the person chose (issue #164)", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
      storage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      } as unknown as Platform["storage"],
      data,
    };
  };

  test("shown and not tested by default; the choices come back after a restart", () => {
    const kept = memory();
    const s = new SetupSettings(kept.storage);
    expect([s.hidden, s.notified]).toEqual([false, false]);
    s.setHidden(true);
    s.markNotified();
    expect(kept.data.get(SETUP_HIDDEN_KEY)).toBe("on");
    expect(kept.data.get(SETUP_NOTIFIED_KEY)).toBe("on");
    const again = new SetupSettings(kept.storage);
    expect([again.hidden, again.notified]).toEqual([true, true]);
    again.setHidden(false);
    expect(new SetupSettings(kept.storage).hidden).toBe(false);
  });

  test("changing tells the listeners", () => {
    const s = new SetupSettings(memory().storage);
    let told = 0;
    s.subscribe(() => told++);
    s.setHidden(true);
    s.markNotified();
    s.dismissTool("gh@h1");
    expect(told).toBe(3);
  });

  test("dismissed tools are kept by id, once, and unreadable storage means none", () => {
    const kept = memory();
    const s = new SetupSettings(kept.storage);
    s.dismissTool("gh@h1");
    s.dismissTool("gh@h1");
    s.dismissTool("claude@h1");
    expect(s.dismissedTools()).toEqual(["gh@h1", "claude@h1"]);
    expect(new SetupSettings(kept.storage).dismissedTools()).toEqual(["gh@h1", "claude@h1"]);
    expect(
      new SetupSettings(memory({ [SETUP_TOOLS_KEY]: "{no" }).storage).dismissedTools(),
    ).toEqual([]);
    expect(
      new SetupSettings(memory({ [SETUP_TOOLS_KEY]: "[1,2]" }).storage).dismissedTools(),
    ).toEqual([]);
  });
});
