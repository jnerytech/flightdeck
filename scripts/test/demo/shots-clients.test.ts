import { describe, expect, test } from "bun:test";
import { demoSecrets } from "../../lib/demo/seeds.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { clientsShots } from "../../lib/shots/table-clients.ts";

const shots = clientsShots();
const names = shots.map((shot) => shot.name);
const shot = (name: string) => shots.find((s) => s.name === name);

/** The states of the Clients screen the prints did not show (#4345), as the issue lists them. */
const STATES = [
  "clientes-vazio",
  "clientes-renomear",
  "clientes-apagar",
  "clientes-sugestoes",
  "clientes-sugestoes-nada",
  "clientes-exportado",
  "clientes-importar-erro",
  "clientes-importar-ok",
  "clientes-cofre-confirmar",
  "clientes-cofre-achados",
  "clientes-longo",
];

/** The clients a print starts with, as stored. */
const clientsOf = (name: string): Array<Record<string, unknown>> => {
  const data = shot(name)?.clients?.data;
  return data ? (JSON.parse(data) as { clients: Array<Record<string, unknown>> }).clients : [];
};

describe("the Clients screen's prints (#4345)", () => {
  test("every state of the issue has a print of its own", () => {
    expect(STATES.filter((name) => !names.includes(name))).toEqual([]);
  });

  test("no name is printed twice, and each print is the Clients screen", () => {
    expect(names.length).toBe(new Set(names).size);
    expect(shots.filter((s) => s.route.name !== "clients")).toEqual([]);
  });

  test("the empty state starts with no client at all", () => {
    expect(shot("clientes-vazio")?.clients).toBeUndefined();
  });

  test("the suggestions print starts with Acme and no rule, so its remote is unclaimed", () => {
    const [acme, ...others] = clientsOf("clientes-sugestoes");
    expect(acme?.name).toBe("Acme");
    expect(acme?.rules).toEqual([]);
    expect(others).toEqual([]);
  });

  test("the vault prints start with Acme holding the tag ci, and a secret allowed on a second host", () => {
    for (const name of ["clientes-cofre-confirmar", "clientes-cofre-achados"]) {
      const [acme] = clientsOf(name);
      expect((acme?.defaults as { vaultTag?: string }).vaultTag).toBe("ci");
      expect(shot(name)?.secrets).toBe("wide");
    }
  });

  test("the wide secrets are allowed on the second host too, the plain ones on one", () => {
    const hosts = (list: string) =>
      (JSON.parse(list) as Array<{ allowedHosts: string[] }>).map((s) => s.allowedHosts);
    expect(hosts(demoSecrets("demo-alfa", ["demo-beta"]))[0]).toEqual(["demo-alfa", "demo-beta"]);
    expect(hosts(demoSecrets("demo-alfa"))[0]).toEqual(["demo-alfa"]);
  });

  test("the long print holds a long client name and a long folder rule, with a budget", () => {
    const data = JSON.parse(shot("clientes-longo")?.clients?.data ?? "{}") as {
      clients: Array<{ id: string; name: string; rules: Array<{ kind: string; path?: string }> }>;
      budgets: Record<string, number>;
    };
    const [client] = data.clients;
    expect((client?.name ?? "").length).toBeGreaterThan(50);
    const folder = client?.rules.find((rule) => rule.kind === "folder");
    expect((folder?.path ?? "").length).toBeGreaterThan(80);
    expect(Object.keys(data.budgets)).toEqual([client?.id ?? ""]);
  });

  test("the narrow prints list the long row, the rename mode and the findings, where they must wrap", () => {
    const narrow = ["clientes-longo", "clientes-renomear", "clientes-cofre-achados"];
    expect(narrow.filter((name) => narrowSizes("dark", name).length === 0)).toEqual([]);
  });
});
