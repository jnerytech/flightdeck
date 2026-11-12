import { inSequence, type Snippet } from "@flightdeck/protocol";
import { z } from "zod";
import { readStored, validItems } from "@/shared/lib/index.ts";
import { hasFeature } from "../../lib/version.ts";

export const PALETTE_RECENTS_KEY = "flightdeck.paletteRecents";
/** How many used palette entries are kept (the palette shows five). */
const PALETTE_RECENTS_KEPT = 12;

/** A host as the palette reads it: whether it is online and what its daemon offers. */
interface PaletteHost {
  id: string;
  status: string;
  hostInfo?: { features?: readonly string[] } | null;
}

/** What the palette reads and loads through the app's store (#1596). */
export interface PaletteCore {
  hosts(): readonly PaletteHost[];
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** A host's projects; `null` when it could not answer. */
  loadProjects(hostId: string): Promise<readonly { id: string }[] | null>;
  loadBoard(hostId: string, projectId: string): Promise<void>;
  loadSshTargets(hostId: string): Promise<void>;
  loadPersonas(hostId: string): Promise<void>;
  /** A host's snippets; `null` when it could not answer. */
  listSnippets(hostId: string): Promise<{ snippets: Snippet[] } | null>;
  keepSnippets(hostId: string, snippets: Snippet[]): void;
  refreshHub(): Promise<void>;
}

/** The command palette's own store work: what it lists besides live state, and what was used lately. */
export class PaletteSlice {
  constructor(private readonly core: PaletteCore) {}

  /**
   * What the palette lists besides live state: the Sessões lists, each host's projects and their
   * cards. Quiet: a host without a board (or offline) just lists less.
   */
  async load(): Promise<void> {
    const boards = this.core
      .hosts()
      .filter((host) => host.status === "online")
      .map(async (host) => {
        const projects = await this.core.loadProjects(host.id);
        await inSequence(projects ?? [], (project) => this.core.loadBoard(host.id, project.id));
      });
    const targets = this.core
      .hosts()
      .filter(
        (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "ssh", false),
      )
      .map(async (host) => {
        await this.core.loadSshTargets(host.id);
      });
    const personas = this.core
      .hosts()
      .filter(
        (host) =>
          host.status === "online" && hasFeature(host.hostInfo?.features, "personas", false),
      )
      .map((host) => this.core.loadPersonas(host.id));
    const snippets = this.core
      .hosts()
      .filter(
        (host) =>
          host.status === "online" && hasFeature(host.hostInfo?.features, "snippets", false),
      )
      .map(async (host) => {
        const listed = await this.core.listSnippets(host.id);
        if (listed) this.core.keepSnippets(host.id, listed.snippets);
      });
    await Promise.all([this.core.refreshHub(), ...boards, ...targets, ...snippets, ...personas]);
  }

  /** What the palette was used for lately, most recent first. */
  recents(): string[] {
    return readStored(this.core.storage, PALETTE_RECENTS_KEY, validItems(z.string()), []);
  }

  /** Remembers that a palette entry was used: first in the list, each id once, a few kept. */
  recordUse(id: string): void {
    const next = [id, ...this.recents().filter((other) => other !== id)].slice(
      0,
      PALETTE_RECENTS_KEPT,
    );
    this.core.storage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  }
}
