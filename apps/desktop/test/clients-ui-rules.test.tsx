import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const KEYS: Record<string, string> = {
  s1: "github.com/acme/api",
  s2: "github.com/beta/app",
  s3: "github.com/acme/web",
};
const managed = (id: string) => ({
  id,
  name: null,
  cwd: `/r/${id}`,
  status: "idle",
  permissionMode: "default",
  model: null,
  claudeSessionId: null,
  lastSeq: 0,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T11:00:00.000Z",
  projectKey: KEYS[id],
});

const acme = (rules: unknown[] = []) => ({
  v: 1,
  clients: [{ id: "acme", name: "Acme", color: "indigo", rules, defaults: { vaultScope: false } }],
  overrides: {},
});

/** The Clients screen on `hosts` host(s) that have three sessions in three projects. */
async function open(initial: unknown, hosts = ["alfa"]) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify(initial));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  for (const name of hosts) {
    const daemon = legacyDaemon(cleanups);
    daemon.hub.managed = ["s1", "s2", "s3"].map(managed);
    await act(() => store.addHost({ name, url: daemon.url, token: TOKEN }));
  }
  await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
  await settle(() =>
    hosts.every((_, i) => store.getState().hub[store.getState().hosts[i]?.id ?? ""]),
  );
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  return { store };
}

const formEl = () => {
  const found = screen.queryByRole("form", { name: "Nova regra de Acme" });
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const field = (label: string) => {
  const found = within(formEl()).queryByLabelText(label);
  expect(found).not.toBeNull();
  return found as HTMLInputElement;
};
const choose = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(field(label), { target: { value } });
  });
};
const rules = () =>
  [...(screen.queryByRole("list", { name: "Regras de Acme" })?.querySelectorAll("li") ?? [])].map(
    (li) => li.textContent ?? "",
  );
const preview = () => formEl().querySelector("[data-rule-preview]")?.textContent ?? "";
const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

describe("clients-ui: the rules of a client", () => {
  test("a remote rule is previewed with the projects it claims, then added to the client", async () => {
    const { store } = await open(acme());
    expect(rules()).toEqual([]);
    await choose("Valor da regra", "github.com/acme/*");
    expect(preview()).toBe("Casa com 2 projetos agora.");
    await choose("Valor da regra", "github.com/beta/app");
    expect(preview()).toBe("Casa com 1 projeto agora.");
    await choose("Valor da regra", "github.com/none/*");
    expect(preview()).toBe("Não casa com nenhum projeto agora.");
    await choose("Valor da regra", "github.com/acme/*");
    await click("Adicionar regra");
    await settle(() => rules().length === 1);
    expect(rules()[0]).toContain("github.com/acme/*");
    expect(store.clients.list()[0]?.rules.map((r) => r.kind)).toEqual(["remote"]);
    expect(field("Valor da regra").value).toBe("");
  });

  test("a folder rule can be limited to a host, chosen by name", async () => {
    const { store } = await open(acme());
    await choose("Tipo da regra", "folder");
    await choose("Valor da regra", "/r");
    expect(preview()).toBe("Casa com 3 projetos agora.");
    await choose("Host da regra", store.getState().hosts[0]?.id ?? "");
    await click("Adicionar regra");
    await settle(() => rules().length === 1);
    expect(rules()[0]).toContain("/r");
    expect(rules()[0]).toContain("alfa");
    expect(store.clients.list()[0]?.rules[0]).toMatchObject({ kind: "folder", path: "/r" });
  });

  test("a rule with no value cannot be added", async () => {
    await open(acme());
    const add = screen.queryByRole("button", {
      name: "Adicionar regra",
    }) as HTMLButtonElement | null;
    expect(add).not.toBeNull();
    expect(add?.disabled).toBe(true);
    expect(preview()).toBe("");
  });

  test("rules are reordered and removed", async () => {
    const { store } = await open(
      acme([
        { id: "r1", kind: "remote", pattern: "a/*" },
        { id: "r2", kind: "remote", pattern: "b/*" },
      ]),
    );
    expect(rules()).toHaveLength(2);
    await click("Descer regra a/*");
    await settle(() => rules()[0]?.includes("b/*") === true);
    expect(store.clients.list()[0]?.rules.map((r) => r.id)).toEqual(["r2", "r1"]);
    await click("Subir regra a/*");
    await settle(() => rules()[0]?.includes("a/*") === true);
    await click("Remover regra a/*");
    await settle(() => rules().length === 1);
    expect(rules()[0]).toContain("b/*");
  });

  test("a rule for a host that is gone says so, and matches nothing", async () => {
    await open(acme([{ id: "r1", kind: "folder", path: "/r", host: "ghost" }]));
    expect(rules()).toHaveLength(1);
    expect(rules()[0]).toContain("host desconhecido");
    expect(rules()[0]).not.toContain("Casa com");
  });

  test("two hosts that share a daemon name are named in a note", async () => {
    await open(acme(), ["alfa", "beta"]);
    expect(screen.queryByText(/Dois hosts usam o mesmo nome/)).not.toBeNull();
  });

  test("with distinct host names there is no note", async () => {
    await open(acme());
    expect(screen.queryByText(/Dois hosts usam o mesmo nome/)).toBeNull();
  });
});
