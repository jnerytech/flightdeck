import type { CommandResults, Snippet } from "@flightdeck/protocol";
import type { Platform } from "../../platform/types.ts";
import { type AppSnippet, GlobalSnippets } from "./global-snippets.ts";

/** The snippet to fill and use now, from the palette or a terminal's list (phase 18). */
export type SnippetChoice = {
  hostId: string | null;
  snippetId: string;
  snippet?: AppSnippet;
} | null;

/** The snippets' part of the app's state (#1596): the hosts' lists and the choice being used. */
export interface SnippetsSliceState {
  /** The snippets of each host that keeps them, by host id; read when the palette or the snippets page opens. */
  snippets: Record<string, Snippet[]>;
  /** The snippet to fill and use now, from the palette or a terminal's list (phase 18). */
  snippetChoice: SnippetChoice;
}

/** A fresh initial state for each store: its record is never shared between stores. */
export const initialSnippetsState = (): SnippetsSliceState => ({
  snippets: {},
  snippetChoice: null,
});

/** What the snippets read and ask through the app's store. */
export interface SnippetsCore {
  state(): SnippetsSliceState;
  update(patch: Partial<SnippetsSliceState>): void;
  /** Where the global snippets are kept. */
  storage: Platform["storage"];
  /** A host's prompt snippets; null when it refuses (the toast says why). */
  list(hostId: string, type: "prompt"): Promise<CommandResults["snippets.list"] | null>;
  /** One host snippet; null when it refuses. */
  get(hostId: string, id: string): Promise<CommandResults["snippets.get"] | null>;
  /** One host snippet rendered for a folder, without a toast when the host refuses. */
  render(
    hostId: string,
    id: string,
    cwd: string,
  ): Promise<{ ok: true; data: CommandResults["snippets.render"] } | { ok: false }>;
}

/** The saved commands and prompts (phase 18; #1596: a slice of the store). */
export class SnippetsSlice {
  /** Phase 18: the global snippets, kept by the app. */
  readonly global: GlobalSnippets;

  constructor(private readonly core: SnippetsCore) {
    this.global = new GlobalSnippets({ storage: core.storage });
  }

  /** Keeps a host's snippets as listed, for the palette and the use dialog (phase 18). */
  keep(hostId: string, snippets: Snippet[]): void {
    this.core.update({ snippets: { ...this.core.state().snippets, [hostId]: snippets } });
  }

  /** Opens the use dialog for a snippet (`null` closes it): from the palette or a terminal's list. */
  choose(choice: SnippetChoice): void {
    this.core.update({ snippetChoice: choice });
  }

  /**
   * Phase 18: the prompt snippets a session's message box offers after `/`, the host's and the
   * app's, and the text of one: filled from the session's folder, or as written when a field
   * still needs a value (the person completes it in the box).
   */
  prompts(hostId: string, cwd: string) {
    return {
      list: async () => {
        const listed = await this.core.list(hostId, "prompt");
        return [
          ...(listed?.snippets ?? []).map((s) => ({ key: `host:${s.id}`, name: s.name })),
          ...this.global
            .list({ type: "prompt" })
            .map((s) => ({ key: `global:${s.id}`, name: s.name })),
        ];
      },
      fill: async (key: string): Promise<string> => {
        const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (kind === "global") {
          const snippet = this.global.list().find((s) => s.id === id);
          try {
            return this.global.use(id, {}, { cwd });
          } catch {
            return snippet?.text ?? "";
          }
        }
        const rendered = await this.core.render(hostId, id, cwd);
        if (rendered.ok) return rendered.data.text;
        const got = await this.core.get(hostId, id);
        return got?.text ?? "";
      },
    };
  }
}
