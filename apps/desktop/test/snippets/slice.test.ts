import { describe, expect, test } from "bun:test";
import {
  initialSnippetsState,
  type SnippetsCore,
  SnippetsSlice,
} from "../../src/features/snippets/index.ts";
import { memoryPlatform } from "../fixtures.ts";

const hostSnippet = (id: string, name: string, text: string) =>
  ({ id, name, text, type: "prompt" }) as never;

/** A slice over a bare state, with a host that answers from the given tables. */
function slice(host: { render?: Record<string, string>; get?: Record<string, string> } = {}) {
  let state = initialSnippetsState();
  const asked: string[] = [];
  const core: SnippetsCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    storage: memoryPlatform().platform.storage,
    list: async (hostId, type) => {
      asked.push(`list ${hostId} ${type}`);
      return {
        snippets: [hostSnippet("h1", "from-host", "Host text")],
        file: null,
      } as never;
    },
    get: async (_hostId, id) => (host.get?.[id] ? hostSnippet(id, id, host.get[id]) : null),
    render: async (_hostId, id, cwd) => {
      const text = host.render?.[id];
      return text === undefined
        ? { ok: false }
        : { ok: true, data: { text: `${text}@${cwd}`, fields: [] } };
    },
  };
  return { snippets: new SnippetsSlice(core), state: () => state, asked };
}

describe("the snippets slice", () => {
  test("keeps each host's list apart and the choice until it is closed", () => {
    const { snippets, state } = slice();
    snippets.keep("a", [hostSnippet("1", "one", "x")]);
    snippets.keep("b", []);
    expect(Object.keys(state().snippets)).toEqual(["a", "b"]);
    snippets.choose({ hostId: "a", snippetId: "1" });
    expect(state().snippetChoice).toEqual({ hostId: "a", snippetId: "1" });
    snippets.choose(null);
    expect(state().snippetChoice).toBeNull();
  });

  test("the prompt list names the host's snippets, then the global ones", async () => {
    const { snippets, asked } = slice();
    const own = snippets.global.save({ name: "mine", type: "prompt", text: "Mine." });
    snippets.global.save({ name: "a-command", type: "command", run: "ls" });
    const list = await snippets.prompts("h", "/work").list();
    expect(list).toEqual([
      { key: "host:h1", name: "from-host" },
      { key: `global:${own.id}`, name: "mine" },
    ]);
    expect(asked).toEqual(["list h prompt"]);
  });

  test("a global prompt is filled from the folder, or as written when a field needs a value", async () => {
    const { snippets } = slice();
    const plain = snippets.global.save({ name: "plain", type: "prompt", text: "In {{cwd}}." });
    const open = snippets.global.save({ name: "open", type: "prompt", text: "Sum {{file}}." });
    const { fill } = snippets.prompts("h", "/work");
    expect(await fill(`global:${plain.id}`)).toBe("In /work.");
    expect(await fill(`global:${open.id}`)).toBe("Sum {{file}}.");
  });

  test("a host prompt is rendered by the host, or read as written when it cannot", async () => {
    const { snippets } = slice({ render: { r: "Rendered" }, get: { g: "As written" } });
    const { fill } = snippets.prompts("h", "/work");
    expect(await fill("host:r")).toBe("Rendered@/work");
    expect(await fill("host:g")).toBe("As written");
    expect(await fill("host:none")).toBe("");
  });
});
