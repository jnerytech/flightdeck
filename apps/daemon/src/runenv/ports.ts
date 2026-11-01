import type { Database } from "bun:sqlite";
import { createServer } from "node:net";
import { FlightdeckError } from "../errors.ts";
import { portVariable } from "./config.ts";

/** Where the blocks start when the config does not say (`run.portBase`). */
export const DEFAULT_PORT_BASE = 41000;

/** The ports of one card's block. */
export const BLOCK_SIZE = 10;

const LAST_PORT = 65535;

/** Whether nothing listens on this machine's port. */
export type PortProbe = (port: number) => Promise<boolean>;

/** The real probe: a port is free when a server can listen on it on the loopback address. */
export function loopbackFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export type PortMap = Record<string, number>;

/** `FLIGHTDECK_PORT_<NAME>` for each port of the card. */
export function portEnv(ports: PortMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [portVariable(name), String(port)]),
  );
}

const PORT_REFERENCE = /\{\{\s*port\.([\w-]+)\s*\}\}/g;

/** Replaces `{{port.<name>}}` with the card's port; a name without one is a bug and throws. */
export function interpolatePorts(text: string, ports: PortMap): string {
  return text.replace(PORT_REFERENCE, (_raw, name: string) => {
    const port = ports[name];
    if (port === undefined) throw new Error(`porta sem bloco: ${name}`);
    return String(port);
  });
}

export interface CardPortsOptions {
  db: Database;
  /** `run.portBase` of the config; 41000 when absent. */
  base?: number;
  /** Tests inject; the real one listens on the loopback. */
  isFree?: PortProbe;
}

/** The blocks of 10 ports of the cards: one per card, until the card is concluded. */
export class CardPorts {
  private readonly base: number;
  private readonly isFree: PortProbe;
  /** Reservations one after another: two cards never pick the same block. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: CardPortsOptions) {
    this.base = opts.base ?? DEFAULT_PORT_BASE;
    this.isFree = opts.isFree ?? loopbackFree;
  }

  /** The card's ports, by name: the name's place in the list is its port in the block. */
  async reserve(cardId: string, names: string[]): Promise<PortMap> {
    const turn = this.queue.then(() => this.blockFor(cardId));
    this.queue = turn.catch(() => {});
    const start = await turn;
    return Object.fromEntries(names.map((name, i) => [name, start + i]));
  }

  /** The first port of the card's block, or `null` without one. */
  blockOf(cardId: string): number | null {
    const row = this.opts.db
      .query<{ block_start: number }, [string]>(
        "SELECT block_start FROM card_ports WHERE card_id = ?",
      )
      .get(cardId);
    return row?.block_start ?? null;
  }

  release(cardId: string): void {
    this.opts.db.query("DELETE FROM card_ports WHERE card_id = ?").run(cardId);
  }

  /** Releases the block of every card that reaches `done` or is discarded. */
  follow(
    watch: (
      listener: (card: { id: string; column: string; discarded?: boolean }) => void,
    ) => () => void,
  ): () => void {
    return watch((card) => {
      if (card.column === "done" || card.discarded === true) this.release(card.id);
    });
  }

  private async blockFor(cardId: string): Promise<number> {
    const kept = this.blockOf(cardId);
    if (kept !== null) return kept;
    const taken = new Set(
      this.opts.db
        .query<{ block_start: number }, []>("SELECT block_start FROM card_ports")
        .all()
        .map((row) => row.block_start),
    );
    for (let start = this.base; start + BLOCK_SIZE - 1 <= LAST_PORT; start += BLOCK_SIZE) {
      if (taken.has(start) || !(await this.blockFree(start))) continue;
      this.opts.db
        .query("INSERT INTO card_ports (card_id, block_start) VALUES (?, ?)")
        .run(cardId, start);
      return start;
    }
    throw new FlightdeckError("invalid_state", `sem bloco de ${BLOCK_SIZE} portas livres`);
  }

  private async blockFree(start: number): Promise<boolean> {
    for (let port = start; port < start + BLOCK_SIZE; port++) {
      if (!(await this.isFree(port))) return false;
    }
    return true;
  }
}
