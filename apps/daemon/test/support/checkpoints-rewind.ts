import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rewinder } from "../../src/checkpoints/rewind.ts";
import { Snapshots } from "../../src/checkpoints/snapshots.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { git, gitRepo } from "./board-helpers.ts";

export const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** A repo where turn 1 edits README, deletes .gitignore's neighbour and creates a file. */
export async function turnInRepo(sessions = { busy: () => false, rewindFiles: async () => null }) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const snapshots = new Snapshots({ db: store.db });
  const { repo } = gitRepo();
  writeFileSync(join(repo, "apagar.txt"), "vai sumir\n");
  git(repo, "add", "apagar.txt");
  git(repo, "commit", "-q", "-m", "apagar");
  mkdirSync(join(repo, "node_modules"));
  writeFileSync(join(repo, "node_modules", "lixo.js"), "ignorado\n");
  const before = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
  writeFileSync(join(repo, "README.md"), "# repo\nlinha nova\n");
  writeFileSync(join(repo, "novo.txt"), "criado no turno\n");
  rmSync(join(repo, "apagar.txt"));
  await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "after" });
  const turn = "row" in before ? before.row.n : -1;
  return { store, snapshots, repo, turn, rewinder: new Rewinder({ snapshots, sessions }) };
}
