import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import type { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, TOKEN } from "./fixtures.ts";

/** A real daemon with the personas and a git project "repo" on its board. */
export async function personasHost(
  cleanups: Array<() => unknown>,
  store: AppStore,
  options: Parameters<typeof makeDaemon>[1] = { personas: true, terminals: true, agentcfg: true },
) {
  const d = makeDaemon(cleanups, options);
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
  await store.hostCommand(hostId, "project.add", { path: repo });
  /** A versioned persona of the project, as a file under `.flightdeck/personas`. */
  const writePersona = (id: string, name: string, body: string) => {
    mkdirSync(join(repo, ".flightdeck", "personas"), { recursive: true });
    writeFileSync(
      join(repo, ".flightdeck", "personas", `${id}.md`),
      `---\nid: ${id}\nname: "${name}"\ndescription: "Do projeto"\n---\n${body}\n`,
    );
  };
  return { d, hostId, repo, writePersona };
}
