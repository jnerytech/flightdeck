import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundleCode } from "../../apps/daemon/src/teleport/bundle.ts";
import {
  DEMO_TELEPORT_SESSION,
  DEMO_TELEPORT_SESSIONS,
  teleportReady,
} from "../lib/demo-teleport.ts";
import { realTempDir } from "./temp-dir.ts";

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const temp = (prefix: string) => {
  const dir = realTempDir(prefix);
  cleanups.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]) => {
  execFileSync("git", args, { cwd, stdio: "ignore" });
};

/** A repository like the demo's flightdeck-web: one commit on main, an origin that is never fetched. */
function alfaRepo(): string {
  const repo = join(temp("fd-demo-alfa-"), "flightdeck-web");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.email", "demo@flightdeck.local");
  git(repo, "config", "user.name", "Demo");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "app.ts"), "export const versao = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  git(repo, "remote", "add", "origin", "git@github.com:Acme/App.git");
  return repo;
}

/**
 * Issue #100: the demo's session can move from alfa to beta. The daemon reads only a transcript with
 * a UUID name, bundles from an `origin` branch, and lands where beta already has the base commit.
 */
describe("demo-teleport: the demo has a session that can move to the other host (#100)", () => {
  test("the movable transcript's name is a UUID, the only kind the daemon reads", () => {
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(DEMO_TELEPORT_SESSION),
    ).toBe(true);
  });

  test("each language has its own movable transcript, since a session already on beta cannot be imported twice (#790)", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const { en, "pt-BR": pt } = DEMO_TELEPORT_SESSIONS;
    expect({
      en: en === DEMO_TELEPORT_SESSION,
      uuids: uuid.test(en) && uuid.test(pt),
      apart: en !== pt,
    }).toEqual({
      en: true,
      uuids: true,
      apart: true,
    });
  });

  test("alfa's repository bundles from origin/main, and beta's clone has that commit", async () => {
    const alfa = alfaRepo();
    const betaProjects = temp("fd-demo-beta-");
    const beta = teleportReady(git, alfa, betaProjects);
    const bundle = await bundleCode({
      cwd: alfa,
      folder: temp("fd-demo-pkg-"),
      id: "demo-pkg",
      scan: () => [],
    }).then(
      (made) => made,
      (error: { reason?: string }) => error.reason ?? "error",
    );
    const baseSha = typeof bundle === "string" ? "" : bundle.baseSha;
    const has =
      beta !== "" &&
      spawnSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], { cwd: beta }).status === 0;
    expect([
      typeof bundle === "string" ? bundle : bundle.base,
      dirname(beta) === betaProjects,
      has,
      spawnSync("git", ["remote", "get-url", "origin"], { cwd: alfa }).stdout.toString().trim(),
    ]).toEqual(["origin/main", true, true, "git@github.com:Acme/App.git"]);
  });
});
