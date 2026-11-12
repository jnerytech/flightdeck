import type { Database } from "bun:sqlite";
import type { Card, Project } from "@flightdeck/protocol";
import type { Config } from "../config.ts";
import { whichOnPath } from "../kernel/index.ts";
import type { DomainModule } from "../server/index.ts";
import { BgService, type BgServiceOptions } from "./service.ts";

/** What the daemon hands Claude Code's background sessions (issue #1593). */
export interface BgDeps {
  db: Database;
  config: Pick<Config, "claude" | "allowedRoots">;
  /** Delivers a message through the channel of a session opened with `flightdeckd claude`. */
  channel: NonNullable<BgServiceOptions["channel"]>;
  projectTrust: {
    sessionTrust: NonNullable<BgServiceOptions["trust"]>;
    prepare: NonNullable<BgServiceOptions["prepare"]>;
  };
  board: {
    getCard(id: string): Pick<Card, "title" | "description" | "projectId">;
    getProject(id: string): Pick<Project, "path">;
  };
  /** This daemon's command line and its config file, for the sessions it starts. */
  self: string[];
  configFile: string;
}

/** The background sessions' options as the daemon builds them. */
export function bgOptions({
  db,
  config,
  channel,
  projectTrust,
  board,
  self,
  configFile,
}: BgDeps): BgServiceOptions {
  return {
    db,
    claude: () => config.claude?.executablePath ?? whichOnPath("claude") ?? null,
    channel,
    trust: (cwd) => projectTrust.sessionTrust(cwd),
    prepare: (cwd) => projectTrust.prepare(cwd),
    // A listed session's folder is checked against the roots before respawn or message runs in it.
    allowedRoots: config.allowedRoots,
    // `getCard` refuses a card that does not exist, with the not_found the app knows.
    card: (cardId) => {
      const card = board.getCard(cardId);
      const prompt = [card.title, card.description].filter(Boolean).join("\n\n");
      return { cwd: board.getProject(card.projectId).path, prompt, name: card.title };
    },
    start: { self, configFile, allowedRoots: config.allowedRoots },
  };
}

/** Claude Code's background sessions (`claude --bg`), wired to this daemon, as the module the server takes `bg` from. */
export function createBg(deps: BgDeps) {
  const module: DomainModule<"bg"> = { server: { bg: new BgService(bgOptions(deps)) } };
  return { modules: [module] as const };
}
