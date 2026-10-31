import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import type { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, TOKEN } from "./fixtures.ts";

/** A real daemon with the project's auto memory (under its own claude-home) and a git project. */
export async function memoriaHost(cleanups: Array<() => unknown>, store: AppStore) {
  const d = makeDaemon(cleanups, { agentcfg: true, memory: true });
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  const deadline = Date.now() + 5000;
  while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  const dir = d.memory?.dir(repo) ?? "";
  /** A file of the project's memory, written straight to its folder. */
  const put = (name: string, text: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  return { d, hostId, repo, projectId: project?.id ?? "", dir, put };
}
