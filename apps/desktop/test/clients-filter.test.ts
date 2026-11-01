import { describe, expect, test } from "bun:test";
import type { KnownProject } from "../src/lib/client-rules.ts";
import {
  ALL_CLIENTS,
  CLIENT_SELECTION_KEY,
  ClientScope,
  loadSelection,
  saveSelection,
  sessionProjectKeys,
} from "../src/lib/client-scope.ts";
import { type Client, type ClientRule, UNASSIGNED } from "../src/lib/clients.ts";

const remote = (pattern: string): ClientRule => ({ id: `r:${pattern}`, kind: "remote", pattern });
const folder = (path: string, host?: string): ClientRule => ({
  id: `f:${path}`,
  kind: "folder",
  path,
  ...(host ? { host } : {}),
});
const client = (id: string, name: string, ...rules: ClientRule[]): Client => ({
  id,
  name,
  color: "emerald",
  rules,
  defaults: { vaultScope: false },
});
const acme = client("acme", "Acme", remote("github.com/acme/*"));
const beta = client("beta", "Beta", remote("github.com/beta/*"));

function storageOf(initial?: string) {
  const items = new Map<string, string>(
    initial === undefined ? [] : [[CLIENT_SELECTION_KEY, initial]],
  );
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("clients-filter: the selection", () => {
  test("nothing stored means all clients", () => {
    expect(loadSelection(storageOf(), [acme])).toBe(ALL_CLIENTS);
  });

  test("a client that exists, or Unassigned while clients exist, is restored", () => {
    expect(loadSelection(storageOf("beta"), [acme, beta])).toBe("beta");
    expect(loadSelection(storageOf(UNASSIGNED), [acme])).toBe(UNASSIGNED);
    expect(loadSelection(storageOf(ALL_CLIENTS), [acme])).toBe(ALL_CLIENTS);
  });

  test("a client that is gone, or any selection with no client at all, is all clients", () => {
    expect(loadSelection(storageOf("ghost"), [acme])).toBe(ALL_CLIENTS);
    expect(loadSelection(storageOf("acme"), [])).toBe(ALL_CLIENTS);
    expect(loadSelection(storageOf(UNASSIGNED), [])).toBe(ALL_CLIENTS);
  });

  test("a selection is saved where the next start reads it", () => {
    const storage = storageOf();
    saveSelection(storage, "acme");
    expect(storage.items.get(CLIENT_SELECTION_KEY)).toBe("acme");
    expect(loadSelection(storage, [acme])).toBe("acme");
  });
});

describe("clients-filter: which projects a selection shows", () => {
  const scope = new ClientScope({ clients: [acme, beta], overrides: {} }, []);
  const keys = [
    "github.com/acme/api",
    "github.com/beta/app",
    "github.com/other/x",
    "github.com/acme/web",
  ];

  test("all shows everything", () => {
    expect(scope.filter(keys, ALL_CLIENTS, (k) => k)).toEqual(keys);
  });

  test("a client shows its projects, in the order they came", () => {
    expect(scope.filter(keys, "acme", (k) => k)).toEqual([
      "github.com/acme/api",
      "github.com/acme/web",
    ]);
    expect(scope.filter(keys, "beta", (k) => k)).toEqual(["github.com/beta/app"]);
  });

  test("Unassigned shows what no client claims", () => {
    expect(scope.filter(keys, UNASSIGNED, (k) => k)).toEqual(["github.com/other/x"]);
  });

  test("a selection that names no client shows nothing", () => {
    expect(scope.includes("ghost", "github.com/acme/api")).toBe(false);
  });

  test("items are filtered by the key a function reads from them", () => {
    const rows = [
      { title: "a", projectKey: "github.com/acme/api" },
      { title: "b", projectKey: "github.com/beta/app" },
    ];
    expect(scope.filter(rows, "beta", (r) => r.projectKey).map((r) => r.title)).toEqual(["b"]);
  });

  test("a manual override moves a project between selections", () => {
    const moved = new ClientScope(
      {
        clients: [acme, beta],
        overrides: { "github.com/acme/api": "beta", "github.com/beta/app": null },
      },
      [],
    );
    expect(moved.clientOf("github.com/acme/api")).toBe("beta");
    expect(moved.clientOf("github.com/beta/app")).toBe(UNASSIGNED);
    expect(moved.filter(keys, "acme", (k) => k)).toEqual(["github.com/acme/web"]);
  });
});

describe("clients-filter: with no client at all", () => {
  const scope = new ClientScope({ clients: [], overrides: {} }, []);

  test("nothing is hidden and nothing wears a chip", () => {
    expect(scope.active).toBe(false);
    expect(scope.filter(["a", "b"], ALL_CLIENTS, (k) => k)).toEqual(["a", "b"]);
    expect(scope.chipOf("github.com/acme/api")).toBeNull();
  });
});

describe("clients-filter: chips", () => {
  const scope = new ClientScope({ clients: [acme], overrides: {} }, []);

  test("a project of a client wears its name and color, an Unassigned one wears none", () => {
    expect(scope.active).toBe(true);
    expect(scope.chipOf("github.com/acme/api")).toEqual({
      id: "acme",
      name: "Acme",
      color: "emerald",
    });
    expect(scope.chipOf("github.com/other/x")).toBeNull();
  });
});

describe("clients-filter: folders of the known projects", () => {
  test("a folder rule claims a remote-keyed project through the folders its sessions ran in", () => {
    const projects: KnownProject[] = [
      { key: "github.com/x/y", cwds: [{ hostId: "h1", path: "/work/acme/y" }] },
    ];
    const scope = new ClientScope(
      { clients: [client("acme", "Acme", folder("/work/acme"))], overrides: {} },
      projects,
    );
    expect(scope.clientOf("github.com/x/y")).toBe("acme");
    expect(scope.clientOf("github.com/x/other")).toBe(UNASSIGNED);
  });

  test("a project known only by a folder key reaches a host-scoped rule through the host's name", () => {
    const hosts = [{ id: "h1", names: ["Laptop", "alfa"] }];
    const rule = client("acme", "Acme", folder("/work/acme", "h1"));
    const scope = new ClientScope({ clients: [rule], overrides: {} }, [], hosts);
    expect(scope.clientOf("host:alfa:/work/acme/web")).toBe("acme");
    expect(scope.clientOf("host:alfa:/work/other")).toBe(UNASSIGNED);
    expect(scope.clientOf("host:beta:/work/acme/web")).toBe(UNASSIGNED);
  });
});

describe("clients-filter: two hosts with one daemon name", () => {
  const hosts = [
    { id: "h1", names: ["Laptop", "ubuntu"] },
    { id: "h2", names: ["Desk", "ubuntu"] },
  ];

  test("a folder key named after both is not guessed for a host-scoped rule, and the name is reported", () => {
    const scoped = client("acme", "Acme", folder("/work/acme", "h1"));
    const scope = new ClientScope({ clients: [scoped], overrides: {} }, [], hosts);
    expect(scope.clientOf("host:ubuntu:/work/acme/web")).toBe(UNASSIGNED);
    expect(scope.ambiguousNames).toEqual(["ubuntu"]);
  });

  test("a rule for any host still claims it, since the folder is the same on both", () => {
    const anyHost = client("acme", "Acme", folder("/work/acme"));
    const scope = new ClientScope({ clients: [anyHost], overrides: {} }, [], hosts);
    expect(scope.clientOf("host:ubuntu:/work/acme/web")).toBe("acme");
  });

  test("a name that one host answers to twice is not ambiguous, and a unique name still maps", () => {
    const one = [
      { id: "h1", names: ["ubuntu", "ubuntu"] },
      { id: "h2", names: ["Desk"] },
    ];
    const scoped = client("acme", "Acme", folder("/work/acme", "h1"));
    const scope = new ClientScope({ clients: [scoped], overrides: {} }, [], one);
    expect(scope.ambiguousNames).toEqual([]);
    expect(scope.clientOf("host:ubuntu:/work/acme/web")).toBe("acme");
  });
});

describe("clients-filter: the projects a rule would claim", () => {
  const projects: KnownProject[] = [
    { key: "github.com/acme/api", cwds: [] },
    { key: "github.com/acme/web", cwds: [{ hostId: "h1", path: "/work/acme/web" }] },
    { key: "github.com/beta/app", cwds: [] },
    { key: "host:alfa:/work/acme/tool", cwds: [] },
  ];
  const hosts = [{ id: "h1", names: ["Laptop", "alfa"] }];
  const scope = new ClientScope({ clients: [], overrides: {} }, projects, hosts);

  test("a remote rule lists the projects with that prefix", () => {
    expect(scope.matching({ kind: "remote", pattern: "github.com/acme/*" })).toEqual([
      "github.com/acme/api",
      "github.com/acme/web",
    ]);
    expect(scope.matching({ kind: "remote", pattern: "nope/*" })).toEqual([]);
  });

  test("a folder rule lists projects by the folders they ran in, and by a folder key through the host's name", () => {
    expect(scope.matching({ kind: "folder", path: "/work/acme" })).toEqual([
      "github.com/acme/web",
      "host:alfa:/work/acme/tool",
    ]);
    expect(scope.matching({ kind: "folder", path: "/work/acme", host: "h1" })).toEqual([
      "github.com/acme/web",
      "host:alfa:/work/acme/tool",
    ]);
    expect(scope.matching({ kind: "folder", path: "/work/acme", host: "ghost" })).toEqual([]);
  });
});

describe("clients-filter: things that touch several projects", () => {
  const scope = new ClientScope({ clients: [acme, beta], overrides: {} }, []);
  const a = "github.com/acme/api";
  const b = "github.com/beta/app";
  const other = "github.com/other/x";

  test("all shows everything, even what touches no known project", () => {
    expect(scope.includesAny(ALL_CLIENTS, [])).toBe(true);
    expect(scope.includesAny(ALL_CLIENTS, [null, null])).toBe(true);
  });

  test("a client shows what touches one of its projects at either end", () => {
    expect(scope.includesAny("acme", [a, b])).toBe(true);
    expect(scope.includesAny("beta", [a, b])).toBe(true);
    expect(scope.includesAny("acme", [b, other])).toBe(false);
    expect(scope.includesAny("acme", [null, a])).toBe(true);
    expect(scope.includesAny("acme", [null, null])).toBe(false);
  });

  test("Unassigned shows what touches a project no client claims, or one the app cannot place", () => {
    expect(scope.includesAny(UNASSIGNED, [a, other])).toBe(true);
    expect(scope.includesAny(UNASSIGNED, [a, null])).toBe(true);
    expect(scope.includesAny(UNASSIGNED, [a, b])).toBe(false);
  });
});

describe("clients-filter: the project of a session", () => {
  test("a session is found by its managed id and by Claude's, each row once", () => {
    const keys = sessionProjectKeys([
      { sessionId: "m1", claudeSessionId: "c1", projectKey: "github.com/acme/api" },
      { sessionId: null, claudeSessionId: "c2", projectKey: "github.com/beta/app" },
      { sessionId: "m3", claudeSessionId: null, projectKey: "host:alfa:/x" },
    ]);
    expect([...keys.entries()]).toEqual([
      ["m1", "github.com/acme/api"],
      ["c1", "github.com/acme/api"],
      ["c2", "github.com/beta/app"],
      ["m3", "host:alfa:/x"],
    ]);
  });
});
