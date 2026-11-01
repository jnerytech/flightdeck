import { describe, expect, test } from "bun:test";
import { CLIENT_COLORS, CLIENTS_KEY, Clients } from "../src/lib/clients.ts";

function setup(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[CLIENTS_KEY, initial]]);
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
  let n = 0;
  const newId = () => `id${++n}`;
  return {
    items,
    storage,
    clients: new Clients({ storage }, { newId }),
    again: () => new Clients({ storage }, { newId }),
  };
}

const names = (c: Clients) => c.list().map((client) => client.name);

describe("clients-model: what is stored", () => {
  test("a missing, unreadable or foreign value is an empty list", () => {
    for (const stored of [undefined, "not json", "[]", '{"v":2,"clients":[],"overrides":{}}']) {
      const { clients } = setup(stored);
      expect(clients.list()).toEqual([]);
      expect(clients.overrides()).toEqual({});
    }
  });

  test("a client stored without defaults gets them, and unknown fields are ignored", () => {
    const stored = JSON.stringify({
      v: 1,
      clients: [{ id: "a", name: "Acme", color: "indigo", rules: [], later: true }],
      overrides: {},
    });
    expect(setup(stored).clients.list()).toEqual([
      { id: "a", name: "Acme", color: "indigo", rules: [], defaults: { vaultScope: false } },
    ]);
  });

  test("what one instance saves another reads", () => {
    const s = setup();
    s.clients.add("Acme");
    expect(names(s.again())).toEqual(["Acme"]);
    expect(JSON.parse(s.items.get(CLIENTS_KEY) ?? "{}").v).toBe(1);
  });
});

describe("clients-model: clients", () => {
  test("a client takes a trimmed name, the next color and no rules", () => {
    const { clients } = setup();
    expect(clients.add("  Acme  ")).toEqual({
      id: "id1",
      name: "Acme",
      color: CLIENT_COLORS[0],
      rules: [],
      defaults: { vaultScope: false },
    });
    expect(clients.add("Beta")?.color).toBe(CLIENT_COLORS[1]);
  });

  test("without an id generator of its own a client gets a distinct id", () => {
    const { storage } = setup();
    const clients = new Clients({ storage });
    const first = clients.add("Acme");
    const second = clients.add("Beta");
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  test("a blank or repeated name (in any case) is refused", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.add("   ")).toBeNull();
    expect(clients.add("acme")).toBeNull();
    expect(names(clients)).toEqual(["Acme"]);
  });

  test("rename keeps the client's rules and refuses the name of another one", () => {
    const { clients } = setup();
    const acme = clients.add("Acme");
    clients.add("Beta");
    clients.addRule(acme?.id ?? "", { kind: "remote", pattern: "github.com/acme/*" });
    expect(clients.rename("id1", "Acme Corp")).toBe(true);
    expect(clients.rename("id1", "beta")).toBe(false);
    expect(clients.rename("id1", " ")).toBe(false);
    expect(clients.rename("nope", "X")).toBe(false);
    expect(clients.rename("id1", "ACME CORP")).toBe(true);
    expect(clients.list()[0]?.name).toBe("ACME CORP");
    expect(clients.list()[0]?.rules).toHaveLength(1);
  });

  test("recolor changes the color of a client that exists", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.recolor("id1", "rose")).toBe(true);
    expect(clients.list()[0]?.color).toBe("rose");
    expect(clients.recolor("nope", "rose")).toBe(false);
  });

  test("move puts a client at an index, clamped to the list", () => {
    const { clients } = setup();
    for (const name of ["A", "B", "C"]) clients.add(name);
    expect(clients.move("id3", 0)).toBe(true);
    expect(names(clients)).toEqual(["C", "A", "B"]);
    expect(clients.move("id3", 99)).toBe(true);
    expect(names(clients)).toEqual(["A", "B", "C"]);
    expect(clients.move("id1", -5)).toBe(true);
    expect(names(clients)).toEqual(["A", "B", "C"]);
    expect(clients.move("nope", 0)).toBe(false);
  });

  test("remove drops the client and the overrides that pinned a project to it, not the pins to Unassigned", () => {
    const { clients } = setup();
    clients.add("Acme");
    clients.add("Beta");
    clients.setOverride("github.com/x/a", "id1");
    clients.setOverride("github.com/x/b", "id2");
    clients.setOverride("github.com/x/c", null);
    expect(clients.remove("id1")).toBe(true);
    expect(names(clients)).toEqual(["Beta"]);
    expect(clients.overrides()).toEqual({ "github.com/x/b": "id2", "github.com/x/c": null });
    expect(clients.remove("id1")).toBe(false);
  });
});

describe("clients-model: rules", () => {
  test("a remote rule is trimmed and lowercased; one with spaces or nothing is refused", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.addRule("id1", { kind: "remote", pattern: " GitHub.com/Acme/* " })).toEqual({
      id: "id2",
      kind: "remote",
      pattern: "github.com/acme/*",
    });
    expect(clients.addRule("id1", { kind: "remote", pattern: "" })).toBeNull();
    expect(clients.addRule("id1", { kind: "remote", pattern: "github.com/a b" })).toBeNull();
    expect(clients.list()[0]?.rules).toHaveLength(1);
  });

  test("a folder rule keeps its path as typed and its host when there is one", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.addRule("id1", { kind: "folder", path: " C:\\Work\\Acme " })).toEqual({
      id: "id2",
      kind: "folder",
      path: "C:\\Work\\Acme",
    });
    expect(
      clients.addRule("id1", { kind: "folder", path: "/home/me/acme", host: " alfa " }),
    ).toEqual({ id: "id3", kind: "folder", path: "/home/me/acme", host: "alfa" });
    expect(clients.addRule("id1", { kind: "folder", path: "/x", host: "  " })).toEqual({
      id: "id4",
      kind: "folder",
      path: "/x",
    });
    expect(clients.addRule("id1", { kind: "folder", path: "  " })).toBeNull();
  });

  test("a rule needs a client that exists", () => {
    const { clients } = setup();
    expect(clients.addRule("nope", { kind: "remote", pattern: "github.com/a/*" })).toBeNull();
  });

  test("rules are removed and reordered inside their client", () => {
    const { clients } = setup();
    clients.add("Acme");
    for (const pattern of ["a/*", "b/*", "c/*"]) {
      clients.addRule("id1", { kind: "remote", pattern });
    }
    const patterns = () =>
      clients
        .list()[0]
        ?.rules.map((r) => (r.kind === "remote" ? r.pattern : r.path))
        .join(",");
    expect(patterns()).toBe("a/*,b/*,c/*");
    expect(clients.moveRule("id1", "id4", 0)).toBe(true);
    expect(patterns()).toBe("c/*,a/*,b/*");
    expect(clients.moveRule("id1", "id4", 99)).toBe(true);
    expect(patterns()).toBe("a/*,b/*,c/*");
    expect(clients.moveRule("id1", "nope", 0)).toBe(false);
    expect(clients.moveRule("nope", "id2", 0)).toBe(false);
    expect(clients.removeRule("id1", "id3")).toBe(true);
    expect(patterns()).toBe("a/*,c/*");
    expect(clients.removeRule("id1", "id3")).toBe(false);
    expect(clients.removeRule("nope", "id2")).toBe(false);
  });
});

describe("clients-model: overrides and defaults", () => {
  test("a project is pinned to a client that exists, or to Unassigned, and unpinned again", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.setOverride("github.com/x/a", "id1")).toBe(true);
    expect(clients.setOverride("github.com/x/b", null)).toBe(true);
    expect(clients.setOverride("github.com/x/c", "nope")).toBe(false);
    expect(clients.overrides()).toEqual({ "github.com/x/a": "id1", "github.com/x/b": null });
    clients.clearOverride("github.com/x/a");
    clients.clearOverride("github.com/x/never");
    expect(clients.overrides()).toEqual({ "github.com/x/b": null });
  });

  test("defaults are merged, and an empty text clears one", () => {
    const { clients } = setup();
    clients.add("Acme");
    expect(clients.setDefaults("id1", { persona: "qa", snippetTag: "acme" })).toBe(true);
    expect(clients.setDefaults("id1", { vaultTag: "client:acme", vaultScope: true })).toBe(true);
    expect(clients.list()[0]?.defaults).toEqual({
      persona: "qa",
      snippetTag: "acme",
      vaultTag: "client:acme",
      vaultScope: true,
    });
    expect(clients.setDefaults("id1", { persona: "  ", vaultScope: false })).toBe(true);
    expect(clients.list()[0]?.defaults).toEqual({
      snippetTag: "acme",
      vaultTag: "client:acme",
      vaultScope: false,
    });
    expect(clients.setDefaults("nope", { persona: "qa" })).toBe(false);
  });
});

describe("clients-model: export and import", () => {
  test("an export carries the clients and the overrides, and nothing else", () => {
    const { clients } = setup();
    clients.add("Acme");
    clients.addRule("id1", { kind: "remote", pattern: "github.com/acme/*" });
    clients.setOverride("github.com/x/a", "id1");
    const out = JSON.parse(clients.exportJson());
    expect(Object.keys(out).sort()).toEqual(["clients", "overrides", "v"]);
    expect(out.clients[0]?.name).toBe("Acme");
    expect(out.overrides).toEqual({ "github.com/x/a": "id1" });
  });

  test("an import adds new ids, replaces the same id and deletes nothing", () => {
    const mine = setup();
    mine.clients.add("Acme");
    mine.clients.add("Local only");
    const theirs = setup();
    theirs.clients.add("Acme renamed");
    theirs.clients.addRule("id1", { kind: "remote", pattern: "github.com/acme/*" });
    theirs.clients.setOverride("github.com/x/a", "id1");
    const dump = JSON.parse(theirs.clients.exportJson());
    dump.clients.push({
      id: "other",
      name: "Other",
      color: "sky",
      rules: [],
      defaults: { vaultScope: false },
    });
    dump.overrides["github.com/x/lost"] = "ghost";
    expect(mine.clients.importJson(JSON.stringify(dump))).toEqual({ added: 1, updated: 1 });
    expect(names(mine.clients)).toEqual(["Acme renamed", "Local only", "Other"]);
    expect(mine.clients.list()[0]?.rules).toHaveLength(1);
    expect(mine.clients.overrides()).toEqual({ "github.com/x/a": "id1" });
    expect(names(mine.again())).toEqual(["Acme renamed", "Local only", "Other"]);
  });

  test("an import of something that is not an export changes nothing", () => {
    const { clients } = setup();
    clients.add("Acme");
    for (const text of ["", "nope", "[]", '{"v":1,"clients":"x"}']) {
      expect(clients.importJson(text)).toBeNull();
    }
    expect(names(clients)).toEqual(["Acme"]);
  });
});
