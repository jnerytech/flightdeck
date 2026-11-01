import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import type { AppState } from "../src/lib/app-store.ts";
import { ALL_CLIENTS, ClientScope, selectedClient, tagsFirst } from "../src/lib/client-scope.ts";
import { type Client, UNASSIGNED } from "../src/lib/clients.ts";
import { paletteSections } from "../src/lib/palette.ts";

const client = (
  id: string,
  patterns: string[],
  defaults: Partial<Client["defaults"]> = {},
): Client => ({
  id,
  name: id,
  color: "indigo",
  rules: patterns.map((path, i) => ({ id: `${id}${i}`, kind: "folder", path })),
  defaults: { vaultScope: false, ...defaults },
});

describe("clients-defaults: the client of a folder", () => {
  const acme = client("acme", ["/work/acme"], { persona: "host:qa", snippetTag: "acme" });
  const beta = {
    ...client("beta", []),
    rules: [{ id: "b", kind: "folder", path: "/work/beta", host: "h2" }],
  } as Client;
  const known = [{ key: "github.com/x/y", cwds: [{ hostId: "h1", path: "/srv/y" }] }];
  const scope = new ClientScope(
    { clients: [acme, beta], overrides: { "github.com/x/y": "beta" } },
    known,
  );

  test("a folder inside a client's folder rule belongs to it", () => {
    expect(scope.clientOfFolder("h1", "/work/acme/api")).toBe("acme");
    expect(scope.clientOfFolder("h1", "/work/other")).toBe(UNASSIGNED);
  });

  test("a folder in a project the app knows belongs to the project's client, override included", () => {
    expect(scope.clientOfFolder("h1", "/srv/y")).toBe("beta");
    expect(scope.clientOfFolder("h1", "/srv/y/sub")).toBe("beta");
  });

  test("a host-scoped rule applies to that host's folders only", () => {
    expect(scope.clientOfFolder("h2", "/work/beta/app")).toBe("beta");
    expect(scope.clientOfFolder("h1", "/work/beta/app")).toBe(UNASSIGNED);
  });

  test("a client is found by its id, and Unassigned or a missing id has none", () => {
    expect(scope.client("acme")?.defaults.persona).toBe("host:qa");
    expect(scope.client(UNASSIGNED)).toBeNull();
    expect(scope.client("ghost")).toBeNull();
  });
});

describe("clients-defaults: the persona of a folder's client", () => {
  const scope = new ClientScope(
    {
      clients: [
        client("acme", ["/work/acme"], { persona: "host:qa" }),
        client("beta", ["/work/beta"], { persona: "app:minha" }),
        client("gama", ["/work/gama"]),
      ],
      overrides: {},
    },
    [],
  );

  test("a folder of a client with a default persona gets it, as the picker writes it", () => {
    expect(scope.defaultPersona("h1", "/work/acme/api")).toBe("host:qa");
    expect(scope.defaultPersona("h1", "/work/beta/app")).toBe("app:minha");
  });

  test("a client without one, and a folder no client has, get none", () => {
    expect(scope.defaultPersona("h1", "/work/gama/x")).toBe("");
    expect(scope.defaultPersona("h1", "/elsewhere")).toBe("");
  });

  test("a picker of plain host ids takes the host's personas only", () => {
    expect(scope.defaultPersona("h1", "/work/acme/api", true)).toBe("qa");
    expect(scope.defaultPersona("h1", "/work/beta/app", true)).toBe("");
  });
});

describe("clients-defaults: the selected client and its tag", () => {
  const list = [client("acme", [], { snippetTag: "acme" }), client("beta", [])];

  test("only a client that exists is selected", () => {
    expect(selectedClient(list, "acme")?.id).toBe("acme");
    for (const selection of [ALL_CLIENTS, UNASSIGNED, "ghost"]) {
      expect(selectedClient(list, selection)).toBeNull();
    }
  });

  test("the items with the tag come first, each group in its own order", () => {
    const items = [
      { id: 1, tags: [] },
      { id: 2, tags: ["acme", "x"] },
      { id: 3, tags: ["other"] },
      { id: 4, tags: ["acme"] },
    ];
    expect(tagsFirst(items, "acme").map((i) => i.id)).toEqual([2, 4, 1, 3]);
    expect(tagsFirst(items, "none").map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(tagsFirst(items, undefined).map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("clients-defaults: the palette lists the client's snippets first", () => {
  const snippet = (id: string, name: string, tags: string[]) => ({
    id,
    name,
    type: "command",
    run: "x",
    tags,
  });
  const state = (selection: string) =>
    ({
      hosts: [{ id: "h1", name: "alfa", status: "online", sessions: [] }],
      sessions: {},
      hub: {},
      externals: {},
      meta: {},
      cards: {},
      projects: {},
      ssh: {},
      snippets: { h1: [snippet("1", "primeiro", []), snippet("2", "do-acme", ["acme"])] },
      clientList: [client("acme", [], { snippetTag: "acme" })],
      clientSelection: selection,
    }) as unknown as AppState;
  const labels = (selection: string) =>
    paletteSections(state(selection), "", { costs: false, t: translator("en") })
      .filter((s) => s.title === "Snippets")
      .flatMap((s) => s.items.map((i) => i.label));

  test("with the client selected its tagged snippets are first", () => {
    expect(labels("acme")).toEqual(["Snippet: do-acme", "Snippet: primeiro"]);
  });

  test("with all clients selected the order is as before", () => {
    expect(labels(ALL_CLIENTS)).toEqual(["Snippet: primeiro", "Snippet: do-acme"]);
  });
});
