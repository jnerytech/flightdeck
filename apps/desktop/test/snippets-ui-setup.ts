import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snippet } from "@flightdeck/protocol";
import { git } from "../../daemon/test/board-helpers.ts";
import type { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, TOKEN } from "./fixtures.ts";

/** A real daemon with snippets and a git project "repo" on its board; `file` is its versioned snippets.yaml. */
export async function snippetsHost(
  cleanups: Array<() => unknown>,
  store: AppStore,
  options: Parameters<typeof makeDaemon>[1] = { snippets: true, terminals: true },
) {
  const d = makeDaemon(cleanups, options);
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "# repo\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await store.hostCommand(hostId, "project.add", { path: repo });
  const save = async (input: Record<string, unknown>): Promise<Snippet> =>
    (await store.hostCommand(hostId, "snippets.save", {
      scope: "host",
      ...input,
    } as never)) as Snippet;
  const writeFile = (text: string) => {
    mkdirSync(join(repo, ".flightdeck"), { recursive: true });
    writeFileSync(join(repo, ".flightdeck", "snippets.yaml"), text);
  };
  return { d, hostId, repo, save, writeFile };
}
