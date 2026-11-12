import type { Database } from "bun:sqlite";
import { present } from "../present.ts";
import type { DomainModule } from "../server/index.ts";
import { RunConfigs } from "./config.ts";
import { terminalRunHost } from "./host.ts";
import { RunManager, type RunManagerOptions } from "./manager.ts";
import { CardPorts, type PortProbe } from "./ports.ts";

/** What a card's run environment is built from: the board's side of it is a port. */
export interface RunEnvDeps {
  db: Database;
  /** `run.portBase` of the config. */
  portBase: number;
  /** Tests inject; the real one listens on the loopback. */
  portProbe: PortProbe | undefined;
  terminals: Parameters<typeof terminalRunHost>[0];
  board: {
    getCard: RunManagerOptions["card"];
    getProject: RunManagerOptions["project"];
    watch(
      listener: (card: { id: string; column: string; discarded?: boolean }) => void,
    ): () => void;
    addIdle(wait: () => Promise<unknown>): void;
    addEnd(end: (cardId: string) => Promise<unknown>): void;
  };
}

/**
 * Phase 24 (issue #1593): each card's run.yaml (scripts, a block of ports, a preview), through the
 * terminals, tied to the board's cards. Its module (#2094) serves the configs and the runs, and its
 * stop stops following the board.
 */
export function createRunEnv({ db, portBase, portProbe, terminals, board }: RunEnvDeps) {
  const configs = new RunConfigs({ db });
  const ports = new CardPorts({ db, base: portBase, ...present({ isFree: portProbe }) });
  const manager = new RunManager({
    db,
    configs,
    ports,
    host: terminalRunHost(terminals),
    card: (id) => board.getCard(id),
    project: (id) => board.getProject(id),
  });
  // A card that is done stops its processes and gives its ports back.
  const unwatch = [
    ports.follow((listener) => board.watch(listener)),
    manager.follow((listener) => board.watch(listener)),
  ];
  // A worktree is not removed while a card's processes are still being ended.
  board.addIdle(manager.idle.bind(manager));
  // A discarded card ends its processes first: a live tree locks the files of its worktree.
  board.addEnd((cardId) => manager.stop(cardId));
  const module: DomainModule<"runenv"> = {
    server: { runenv: { configs, manager } },
    stop: () => {
      for (const stop of unwatch) stop();
    },
  };
  return { modules: [module] as const, configs, ports, manager };
}
