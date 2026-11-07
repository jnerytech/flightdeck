/**
 * Issue #100: the demo can move a session from alfa to beta. The session's transcript has a UUID
 * name (the only kind the daemon reads), alfa's repository has an `origin/main` (what the bundle
 * starts from), and beta has a clone with that commit (the import needs it, with no fetch).
 */
import { join } from "node:path";

/** The Claude session id of the demo's transcript that can move (in alfa's history only). */
export const DEMO_TELEPORT_SESSION = "7e1c2a9b-4f3d-4c8e-9a6b-1d2e3f4a5b6c";

/** One movable transcript per language: a second import of the same session is refused (#790). */
export const DEMO_TELEPORT_SESSIONS: Record<"en" | "pt-BR", string> = {
  en: DEMO_TELEPORT_SESSION,
  "pt-BR": DEMO_TELEPORT_SESSION,
};

/** Runs git in a folder; the demo's own runner, a test's in the tests. */
export type DemoGit = (cwd: string, ...args: string[]) => void;

/**
 * Readies alfa's repository and gives beta its clone; returns the clone's path. Alfa's `origin`
 * keeps its URL (the demo shows it): only its `main` is recorded as it is now, never fetched.
 */
export function teleportReady(git: DemoGit, alfaRepo: string, betaProjects: string): string {
  git(alfaRepo, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(betaProjects, "clone", "-q", "--no-hardlinks", alfaRepo, "flightdeck-web");
  return join(betaProjects, "flightdeck-web");
}
