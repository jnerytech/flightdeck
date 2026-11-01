import { describe, expect, test } from "bun:test";
import type { KnownProject } from "../src/lib/client-rules.ts";
import { applySuggestion, suggestClients } from "../src/lib/client-suggest.ts";
import { CLIENTS_KEY, Clients } from "../src/lib/clients.ts";

const keys = (...list: string[]): KnownProject[] => list.map((key) => ({ key, cwds: [] }));
const none = { clients: [], overrides: {} };

describe("clients-suggest: what is offered", () => {
  test("one suggestion per host and owner, the largest first (then by pattern), naming the owner", () => {
    const found = suggestClients(
      keys(
        "github.com/zeta/one",
        "github.com/acme/api",
        "github.com/acme/web",
        "github.com/acme/docs",
        "gitlab.com/acme/tools",
        "github.com/beta/app",
        "github.com/beta/lib",
      ),
      none,
    );
    expect(found).toEqual([
      {
        name: "acme",
        pattern: "github.com/acme/*",
        projects: ["github.com/acme/api", "github.com/acme/web", "github.com/acme/docs"],
        existingClientId: null,
      },
      {
        name: "beta",
        pattern: "github.com/beta/*",
        projects: ["github.com/beta/app", "github.com/beta/lib"],
        existingClientId: null,
      },
      {
        name: "zeta",
        pattern: "github.com/zeta/*",
        projects: ["github.com/zeta/one"],
        existingClientId: null,
      },
      {
        name: "acme",
        pattern: "gitlab.com/acme/*",
        projects: ["gitlab.com/acme/tools"],
        existingClientId: null,
      },
    ]);
  });

  test("a project known only by its folder, or by a remote with no owner, offers nothing", () => {
    expect(
      suggestClients(keys("host:alfa:/home/me/acme", "github.com/acme", "example.com"), none),
    ).toEqual([]);
  });

  test("an Azure DevOps organization is the owner, over https and over ssh", () => {
    const found = suggestClients(
      keys("dev.azure.com/orgb/proj/_git/repo", "ssh.dev.azure.com/v3/orgc/proj/repo"),
      none,
    );
    expect(found.map((s) => [s.name, s.pattern])).toEqual([
      ["orgb", "dev.azure.com/orgb/*"],
      ["orgc", "ssh.dev.azure.com/v3/orgc/*"],
    ]);
  });
});

describe("clients-suggest: what is already covered", () => {
  const acme = {
    id: "c1",
    name: "Acme",
    color: "indigo" as const,
    rules: [{ id: "r1", kind: "remote" as const, pattern: "github.com/acme/api" }],
    defaults: { vaultScope: false },
  };

  test("only the projects no rule and no override claims are listed", () => {
    const found = suggestClients(keys("github.com/acme/api", "github.com/acme/web"), {
      clients: [acme],
      overrides: {},
    });
    expect(found.map((s) => [s.pattern, s.projects])).toEqual([
      ["github.com/acme/*", ["github.com/acme/web"]],
    ]);
  });

  test("an owner whose projects are all claimed, or pinned to Unassigned on purpose, is not offered", () => {
    expect(
      suggestClients(keys("github.com/acme/api", "github.com/beta/app", "github.com/beta/lib"), {
        clients: [acme],
        overrides: { "github.com/beta/app": null, "github.com/beta/lib": "c1" },
      }),
    ).toEqual([]);
  });

  test("a client that already has the owner's name is pointed at, not duplicated", () => {
    const found = suggestClients(keys("github.com/acme/web"), {
      clients: [{ ...acme, rules: [] }],
      overrides: {},
    });
    expect(found[0]?.existingClientId).toBe("c1");
  });
});

describe("clients-suggest: applying one", () => {
  function setup() {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    };
    let n = 0;
    return { items, clients: new Clients({ storage }, { newId: () => `id${++n}` }) };
  }
  const suggestion = (existingClientId: string | null) => ({
    name: "acme",
    pattern: "github.com/acme/*",
    projects: ["github.com/acme/web"],
    existingClientId,
  });

  test("looking for suggestions writes nothing", () => {
    const { items } = setup();
    suggestClients(keys("github.com/acme/web"), none);
    expect(items.has(CLIENTS_KEY)).toBe(false);
  });

  test("applying creates the client with the rule", () => {
    const { clients } = setup();
    const made = applySuggestion(clients, suggestion(null));
    expect(made?.name).toBe("acme");
    expect(clients.list()[0]?.rules).toEqual([
      { id: "id2", kind: "remote", pattern: "github.com/acme/*" },
    ]);
  });

  test("applying to an existing client adds the rule and creates no client", () => {
    const { clients } = setup();
    const existing = clients.add("Acme");
    const made = applySuggestion(clients, suggestion(existing?.id ?? null));
    expect(made?.id).toBe(existing?.id);
    expect(clients.list()).toHaveLength(1);
    expect(clients.list()[0]?.rules).toHaveLength(1);
  });

  test("a client that is gone (or a name taken in the meantime) gives nothing and changes nothing", () => {
    const { clients } = setup();
    expect(applySuggestion(clients, suggestion("ghost"))).toBeNull();
    clients.add("ACME");
    expect(applySuggestion(clients, suggestion(null))).toBeNull();
    expect(clients.list()).toHaveLength(1);
    expect(clients.list()[0]?.rules).toEqual([]);
  });
});
