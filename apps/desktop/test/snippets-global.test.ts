import { describe, expect, test } from "bun:test";
import { GlobalSnippets } from "../src/lib/global-snippets.ts";

function setup() {
  const items = new Map<string, string>();
  const platform = {
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    },
  };
  let now = Date.parse("2026-10-30T12:00:00Z");
  let n = 0;
  const options = { clock: () => now++, newId: () => `g${++n}` };
  return { platform, options, items, snippets: new GlobalSnippets(platform, options) };
}

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
};

describe("snippets-escopos: the global snippets of the app", () => {
  test("a command and a prompt are kept with their fields, global and from the app", () => {
    const { snippets } = setup();
    const cmd = snippets.save({
      name: "testes",
      type: "command",
      run: "bun test {{arquivo}}",
      vars: { arquivo: { default: "a.ts" } },
    });
    expect(cmd).toMatchObject({
      id: "g1",
      scope: "global",
      source: "app",
      projectPath: null,
      type: "command",
      run: "bun test {{arquivo}}",
      text: null,
      favorite: false,
      uses: 0,
      lastUsedAt: null,
      runnable: true,
    });
    expect(cmd.fields).toEqual([{ name: "arquivo", special: false, default: "a.ts", options: [] }]);
    const prompt = snippets.save({ name: "revisar", type: "prompt", text: "Revise {{file}}" });
    expect(prompt.fields).toEqual([{ name: "file", special: true, default: null, options: [] }]);
  });

  test("they survive a new instance over the same storage", () => {
    const { snippets, platform, options } = setup();
    snippets.save({ name: "status", type: "command", run: "git status" });
    expect(new GlobalSnippets(platform, options).list().map((s) => s.name)).toEqual(["status"]);
  });

  test("the daemon's model judges them: a secret is snippet_secret, two lines or a repeated name are bad_request", () => {
    const { snippets } = setup();
    snippets.save({ name: "status", type: "command", run: "git status" });
    expect(
      codeOf(() =>
        snippets.save({
          name: "x",
          type: "command",
          run: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'",
        }),
      ),
    ).toBe("snippet_secret");
    expect(codeOf(() => snippets.save({ name: "y", type: "command", run: "ls\nrm -rf /" }))).toBe(
      "bad_request",
    );
    expect(codeOf(() => snippets.save({ name: "status", type: "command", run: "git log" }))).toBe(
      "bad_request",
    );
    expect(snippets.list().map((s) => s.name)).toEqual(["status"]);
  });

  test("editing keeps the id, the favorite and the uses; renaming to a free name works", () => {
    const { snippets } = setup();
    const saved = snippets.save({ name: "status", type: "command", run: "git status" });
    snippets.favorite(saved.id, true);
    const edited = snippets.save({
      id: saved.id,
      name: "estado",
      type: "command",
      run: "git status -sb",
    });
    expect(edited).toMatchObject({
      id: saved.id,
      name: "estado",
      run: "git status -sb",
      favorite: true,
    });
    expect(snippets.list()).toHaveLength(1);
  });

  test("favorites first, then the most recently used, then by name", () => {
    const { snippets } = setup();
    const a = snippets.save({ name: "a", type: "command", run: "ls" });
    const b = snippets.save({ name: "b", type: "command", run: "pwd" });
    const c = snippets.save({ name: "c", type: "command", run: "date" });
    expect(snippets.list().map((s) => s.name)).toEqual(["a", "b", "c"]);
    snippets.use(c.id, {}, {});
    expect(snippets.list().map((s) => s.name)).toEqual(["c", "a", "b"]);
    snippets.favorite(b.id, true);
    expect(snippets.list().map((s) => s.name)).toEqual(["b", "c", "a"]);
    expect(snippets.list().find((s) => s.id === c.id)?.uses).toBe(1);
    expect(a.id).toBe("g1");
  });

  test("using one fills the values, the defaults and the specials from the context", () => {
    const { snippets } = setup();
    const s = snippets.save({
      name: "t",
      type: "command",
      run: "cd {{cwd}} && bun test {{arquivo}} {{flag}}",
      vars: { flag: { default: "--bail" } },
    });
    expect(snippets.use(s.id, { arquivo: "x.test.ts" }, { cwd: "/repo" })).toBe(
      "cd /repo && bun test x.test.ts --bail",
    );
    expect(codeOf(() => snippets.use(s.id, {}, { cwd: "/repo" }))).toBe("bad_request");
  });

  test("the search looks at the name, the tags and the content, and type and tag filter", () => {
    const { snippets } = setup();
    snippets.save({ name: "deploy", type: "command", run: "kubectl apply -f k8s", tags: ["k8s"] });
    snippets.save({ name: "explicar", type: "prompt", text: "Explique o kubectl" });
    snippets.save({ name: "limpar", type: "command", run: "rm -rf dist" });
    const names = (f: Parameters<typeof snippets.list>[0]) =>
      snippets
        .list(f)
        .map((s) => s.name)
        .sort();
    expect(names({ query: "KUBE" })).toEqual(["deploy", "explicar"]);
    expect(names({ query: "limp" })).toEqual(["limpar"]);
    expect(names({ tag: "k8s" })).toEqual(["deploy"]);
    expect(names({ type: "prompt" })).toEqual(["explicar"]);
  });

  test("remove takes it out", () => {
    const { snippets } = setup();
    const s = snippets.save({ name: "status", type: "command", run: "git status" });
    snippets.remove(s.id);
    expect(snippets.list()).toEqual([]);
  });
});
