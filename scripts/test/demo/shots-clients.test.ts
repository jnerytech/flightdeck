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
      expect(((acme?.defaults ?? {}) as { vaultTag?: string }).vaultTag).toBe("ci");
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

/** Runs a print's `prepare` on a page that records each call and answers with itself. */
async function calls(name: string): Promise<string> {
  const seen: string[] = [];
  const text = (arg: unknown): string => {
    if (arg instanceof RegExp || typeof arg === "string") return String(arg);
    if (typeof arg === "object" && arg !== null) return Object.values(arg).map(text).join(",");
    return typeof arg;
  };
  const member = (call: string): unknown =>
    new Proxy(
      (...args: unknown[]) => {
        seen.push(`${call}(${args.map(text).join(",")})`);
        return recorder;
      },
      { get: (_target, prop) => (recorder as Record<string | symbol, unknown>)[prop] },
    );
  const recorder: unknown = new Proxy(() => recorder, {
    // `then` stays undefined, or awaiting the recorder would wait for it forever.
    get: (_target, prop) => (prop === "then" ? undefined : member(String(prop))),
  });
  await shot(name)?.prepare?.(recorder as never);
  return seen.join(" ");
}

describe("what each Clients print does on the page (#4345)", () => {
  test("every print waits for what it shows before the shot", async () => {
    const waited = await Promise.all(
      STATES.map(async (name) => [name, (await calls(name)).includes("waitFor")] as const),
    );
    expect(waited.filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);
  });

  test("rename and delete press the client's own button, delete only asks", async () => {
    expect(await calls("clientes-renomear")).toMatch(/Rename.*click.*Save name.*scrollIntoView/);
    expect(await calls("clientes-apagar")).toMatch(/Delete.*click.*alertdialog.*waitFor/);
    expect(await calls("clientes-apagar")).not.toMatch(/click\(\).*click\(\)/);
  });

  test("the suggestion prints press the button and wait for the list or for the line saying there is none", async () => {
    expect(await calls("clientes-sugestoes")).toMatch(
      /Suggest from what I have.*click.*Client suggestions/,
    );
    expect(await calls("clientes-sugestoes-nada")).toMatch(/click.*Nothing to suggest.*waitFor/);
  });

  test("the transfer prints export, refuse a text that is not an export, or paste an export back", async () => {
    expect(await calls("clientes-exportado")).toMatch(/Export clients.*click.*Clients export/);
    expect(await calls("clientes-importar-erro")).toMatch(
      /Paste an export.*fill.*Import.*click.*alert/,
    );
    expect(await calls("clientes-importar-erro")).toContain("this is not an export");
    expect(await calls("clientes-importar-ok")).toMatch(
      /Paste an export.*fill.*Import.*click.*Imported/,
    );
  });

  test("the vault prints turn the switch on and wait for the dialog, or wait for the findings", async () => {
    expect(await calls("clientes-cofre-confirmar")).toMatch(/switch.*click.*alertdialog.*waitFor/);
    expect(await calls("clientes-cofre-achados")).toMatch(
      /Secrets that could leave the client.*waitFor/,
    );
    expect(await calls("clientes-longo")).toMatch(/data-client-name.*waitFor.*data-rule-value/);
  });
});
