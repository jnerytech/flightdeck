import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EventStore } from "../../src/store/event-store.ts";
import {
  createProjects,
  createProjectTrust,
  type ProjectTrustDeps,
} from "../../src/trust/wiring.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * A folder's trust as main.ts builds it (issue #1593): a card's worktree is read from its
 * project's checkout, the allowed roots are read at each call, and the library's index asks after
 * looking at the folder.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type Found = NonNullable<ReturnType<ProjectTrustDeps["projectForCwd"]>>;

function setup(found: (project: string) => Found) {
  const store = new EventStore(":memory:");
  const dir = tempDir("trust-wiring-");
  cleanups.push(
    () => store.close(),
    () => rmSync(dir, { recursive: true, force: true }),
  );
  const root = join(dir, "roots");
  const project = join(root, "proj");
  const worktree = join(dir, "worktrees", "c1");
  for (const folder of [project, worktree]) mkdirSync(folder, { recursive: true });
  const config = { allowedRoots: [] as string[] };
  const built = createProjectTrust({
    db: store.db,
    config,
    projectForCwd: (cwd) => (cwd === worktree ? found(project) : null),
    log: () => undefined,
  });
  return { ...built, config, root, project, worktree };
}

const withCard = (path: string) => ({ project: { path }, card: { id: "c1" } });
const withoutCard = (path: string) => ({ project: { path }, card: null });

describe("trust-wiring: the trust the daemon builds (#1593)", () => {
  test("a card's worktree takes its trust from its project's checkout", () => {
    const { projectTrust, project, worktree } = setup(withCard);
    projectTrust.trust(project);
    expect(projectTrust.sessionTrust(worktree)).toEqual({ trusted: true, configRoot: project });
  });

  test("a folder with no card is judged on its own", () => {
    const { projectTrust, project, worktree } = setup(withoutCard);
    projectTrust.trust(project);
    expect(projectTrust.sessionTrust(worktree)).toEqual({ trusted: false });
  });

  test("a root added to the config after the start stops trust by prefix at once", () => {
    const { projectTrust, config, root, project } = setup(withoutCard);
    projectTrust.trust(root);
    expect(projectTrust.isTrusted(project)).toBe(true);
    config.allowedRoots = [root];
    expect(projectTrust.isTrusted(project)).toBe(false);
  });

  test("the library's index gets a session's trust: a card's worktree counts through its project", async () => {
    const { projectTrust, trustForKnowledge, project, worktree, root } = setup(withCard);
    projectTrust.trust(project);
    expect([
      (await trustForKnowledge(worktree)).trusted,
      (await trustForKnowledge(root)).trusted,
    ]).toEqual([true, false]);
  });
});

describe("trust-wiring: the projects group as a module (#1593)", () => {
  test("the module serves the keys, the trust (set tells the live sessions) and find", async () => {
    const { projectTrust, project } = setup(withoutCard);
    let changes = 0;
    const manager = { staleSessions: () => 2, trustChanged: () => void changes++ };
    const keys = { resolve: async (cwd: string) => `key:${cwd}` };
    const [module] = createProjects({ keys, projectTrust, manager }).modules;
    const projects = module.server?.projects;
    const set = projects?.trust?.set(project, true);
    expect({
      key: await projects?.keyOf?.(project),
      warm: await projects?.warmKey?.(project),
      trusted: set?.trusted,
      staleSessions: set?.staleSessions,
      changes,
      find: projects?.find,
    }).toEqual({
      key: `key:${project}`,
      warm: `key:${project}`,
      trusted: true,
      staleSessions: 2,
      changes: 1,
      find: true,
    });
  });
});
