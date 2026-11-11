import { describe, expect, test } from "bun:test";
import { ClientScopeSlice } from "../../src/features/clients/index.ts";
import { ALL_CLIENTS, CLIENT_SELECTION_KEY } from "../../src/lib/client-scope.ts";
import { type Client, UNASSIGNED } from "../../src/lib/clients.ts";

const client = (id: string) => ({ id, name: id, rules: [] }) as unknown as Client;

/** A client scope over stand-ins: the app's state, the storage, the clients kept and what asked to look again. */
function scope(
  over: { clients?: Client[]; selection?: string; overrides?: Record<string, string | null> } = {},
) {
  const clients = over.clients ?? [client("acme"), client("beta")];
  let state = {
    hosts: [{ id: "h", name: "box", hostInfo: { hostName: "box.lan" } }],
    clientList: clients,
    clientOverrides: over.overrides ?? { "repo-a": "acme" },
    clientSelection: over.selection ?? ALL_CLIENTS,
  };
  const kept = new Map<string, string>();
  const log: string[] = [];
  let clientsKept = clients;
  let overridesKept: Record<string, string | null> = { "repo-a": "acme" };
  const slice = new ClientScopeSlice({
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
    },
    clients: () => ({ list: () => clientsKept, overrides: () => overridesKept }),
    projects: () => {
      log.push("projects");
      return [{ key: "repo-a", cwds: [{ hostId: "h", path: "/work/a" }] }];
    },
    changed: () => void log.push("changed"),
  });
  return {
    slice,
    log,
    selection: () => state.clientSelection,
    read: () => ({ list: state.clientList.map((c) => c.id), overrides: state.clientOverrides }),
    moveProject: (key: string, to: string | null) => {
      overridesKept = { ...overridesKept, [key]: to };
    },
    saved: () => kept.get(CLIENT_SELECTION_KEY) ?? null,
    removeClients: (left: Client[]) => {
      clientsKept = left;
    },
    replaceState: () => {
      state = { ...state };
    },
  };
}

describe("client scope (#1596)", () => {
  test("a selection is saved when it is all, Unassigned or a client the person has, and refused otherwise", () => {
    const { slice, selection, saved } = scope();
    slice.select("acme");
    slice.select("nobody");
    const afterBad = [selection(), saved()];
    slice.select(UNASSIGNED);
    const unassigned = selection();
    slice.select(ALL_CLIENTS);
    expect({ afterBad, unassigned, all: selection() }).toEqual({
      afterBad: ["acme", "acme"],
      unassigned: UNASSIGNED,
      all: ALL_CLIENTS,
    });
  });

  test("with no clients only all can be selected", () => {
    const { slice, selection } = scope({ clients: [] });
    slice.select(UNASSIGNED);
    slice.select("acme");
    expect(selection()).toBe(ALL_CLIENTS);
  });

  test("the shortcut goes through all, each client and Unassigned, then back to all", () => {
    const { slice, selection } = scope();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      slice.next();
      seen.push(selection());
    }
    expect(seen).toEqual(["acme", "beta", UNASSIGNED, ALL_CLIENTS]);
  });

  test("the shortcut does nothing without clients", () => {
    const { slice, selection, saved } = scope({ clients: [] });
    slice.next();
    expect([selection(), saved()]).toEqual([ALL_CLIENTS, null]);
  });

  test("a client that changed is read again, a selection that is gone becomes all, and the others look again", () => {
    const { slice, selection, saved, log, removeClients } = scope({ selection: "beta" });
    slice.sync();
    const kept = [selection(), saved(), [...log]];
    removeClients([client("acme")]);
    slice.sync();
    expect({ kept, selection: selection(), saved: saved(), log }).toEqual({
      kept: ["beta", null, ["changed"]],
      selection: ALL_CLIENTS,
      saved: ALL_CLIENTS,
      log: ["changed", "changed"],
    });
  });

  test("a client list and the projects moved by hand are read again into the state", () => {
    const { slice, read, removeClients, moveProject } = scope();
    removeClients([client("beta")]);
    moveProject("repo-a", null);
    slice.sync();
    expect(read()).toEqual({ list: ["beta"], overrides: { "repo-a": null } });
  });

  test("Unassigned stays selected while there are clients and goes back to all when the last one is gone", () => {
    const { slice, selection, saved, removeClients } = scope({ selection: UNASSIGNED });
    slice.sync();
    const kept = selection();
    removeClients([]);
    slice.sync();
    expect({ kept, selection: selection(), saved: saved() }).toEqual({
      kept: UNASSIGNED,
      selection: ALL_CLIENTS,
      saved: ALL_CLIENTS,
    });
  });

  test("a project belongs to the client its override names, worked out once for each state", () => {
    const { slice, log, replaceState } = scope();
    const first = slice.get();
    const again = slice.get();
    replaceState();
    const next = slice.get();
    expect({
      client: first.clientOf("repo-a"),
      folder: first.clientOfFolder("h", "/work/a/src"),
      same: first === again,
      fresh: next !== first,
      looked: log.filter((l) => l === "projects").length,
    }).toEqual({ client: "acme", folder: "acme", same: true, fresh: true, looked: 2 });
  });
});
