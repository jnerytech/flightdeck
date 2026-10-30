import {
  fieldsOf,
  normalizeSnippet,
  renderSnippet,
  SecretScanner,
  type Snippet,
  type SnippetContext,
  type SnippetDef,
  type SnippetInput,
  SnippetModelError,
} from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** A snippet the screen and the palette show: the daemon's, or a global one kept by the app. */
export type AppSnippet = Omit<Snippet, "scope" | "source"> & {
  scope: Snippet["scope"] | "global";
  source: Snippet["source"] | "app";
};

export interface SnippetFilter {
  query?: string;
  type?: "command" | "prompt";
  tag?: string;
}

export interface GlobalSnippetsOptions {
  clock?: () => number;
  newId?: () => string;
}

interface Kept {
  id: string;
  def: SnippetDef;
  favorite: boolean;
  uses: number;
  lastUsedAt: string | null;
}

const KEY = "flightdeck.snippets";

/** Phase 18: the global snippets, in the app's storage, checked by the daemon's own model. */
export class GlobalSnippets {
  private readonly scanner = new SecretScanner();

  constructor(
    private readonly platform: Pick<Platform, "storage">,
    private readonly options: GlobalSnippetsOptions = {},
  ) {}

  private read(): Kept[] {
    const raw = this.platform.storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Kept[]) : [];
  }

  private write(all: Kept[]): void {
    this.platform.storage.setItem(KEY, JSON.stringify(all));
  }

  private view(kept: Kept): AppSnippet {
    const { def } = kept;
    return {
      id: kept.id,
      scope: "global",
      source: "app",
      projectPath: null,
      name: def.name,
      type: def.type,
      run: def.run,
      text: def.text,
      vars: def.vars,
      tags: def.tags,
      fields: fieldsOf(def),
      favorite: kept.favorite,
      uses: kept.uses,
      lastUsedAt: kept.lastUsedAt,
      runnable: true,
    };
  }

  list(filter: SnippetFilter = {}): AppSnippet[] {
    const needle = filter.query?.trim().toLowerCase() ?? "";
    return this.read()
      .filter(({ def }) => {
        const content = [def.name, ...def.tags, def.run ?? def.text ?? ""].join("\n").toLowerCase();
        return (
          (!needle || content.includes(needle)) &&
          (!filter.type || def.type === filter.type) &&
          (!filter.tag || def.tags.includes(filter.tag))
        );
      })
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          a.def.name.localeCompare(b.def.name),
      )
      .map((kept) => this.view(kept));
  }

  /** Creates (no `id`) or edits; refuses like the daemon (`bad_request`, `snippet_secret`). */
  save(input: SnippetInput & { id?: string }): AppSnippet {
    const { id, ...fields } = input;
    const def = normalizeSnippet(fields, this.scanner);
    const all = this.read();
    if (all.some((k) => k.def.name === def.name && k.id !== id)) {
      throw new SnippetModelError("bad_request", `já existe um snippet global chamado ${def.name}`);
    }
    const current = all.find((k) => k.id === id);
    const kept: Kept = current
      ? { ...current, def }
      : {
          id: (this.options.newId ?? (() => crypto.randomUUID()))(),
          def,
          favorite: false,
          uses: 0,
          lastUsedAt: null,
        };
    this.write(current ? all.map((k) => (k.id === id ? kept : k)) : [...all, kept]);
    return this.view(kept);
  }

  remove(id: string): void {
    this.write(this.read().filter((k) => k.id !== id));
  }

  favorite(id: string, favorite: boolean): void {
    this.write(this.read().map((k) => (k.id === id ? { ...k, favorite } : k)));
  }

  /** Fills the template and counts the use. */
  use(id: string, values: Record<string, string>, context: SnippetContext): string {
    const all = this.read();
    const kept = all.find((k) => k.id === id);
    if (!kept) throw new SnippetModelError("bad_request", "snippet global não encontrado");
    const text = renderSnippet(kept.def, values, context);
    const at = new Date((this.options.clock ?? Date.now)()).toISOString();
    this.write(all.map((k) => (k.id === id ? { ...k, uses: k.uses + 1, lastUsedAt: at } : k)));
    return text;
  }
}
