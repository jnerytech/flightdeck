import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ComponentProps } from "react";
import { CLIENTS_KEY } from "../../src/features/clients/domain/clients.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { ClientBudget } = await import("../../src/features/clients/client-budget.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const rule = (id: string, pattern: string) => ({ id, kind: "remote", pattern });
const acme = (rules: unknown[], budgets: Record<string, number> = {}) => ({
  v: 1,
  clients: [{ id: "acme", name: "Acme", color: "indigo", rules, defaults: { vaultScope: false } }],
  overrides: {},
  budgets,
});

/** The Clients screen with one client and one host: the rules and the month limit live in the app. */
async function open(initial: unknown) {
  const platform = memoryPlatform();
  platform.items.set(CLIENTS_KEY, JSON.stringify(initial));
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const daemon = legacyDaemon(cleanups);
  await act(() => store.roster.add({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
  await act(async () => store.router.push({ name: "clients" }));
  await settle(() => screen.queryByRole("heading", { name: "Clientes" }) !== null);
  return { store };
}

const acmeItem = () => {
  const found = [...document.querySelectorAll("li")].find(
    (li) => li.querySelector("[data-client-name]")?.textContent === "Acme",
  );
  expect(found).toBeDefined();
  return found as HTMLElement;
};
const button = (name: string) => within(acmeItem()).queryByRole("button", { name });
const press = async (name: string) => {
  const found = button(name);
  expect(found).not.toBeNull();
  await act(async () => {
    fireEvent.click(found as HTMLElement);
  });
  await uiIdle();
};
const said = () => acmeItem().querySelector("[role=status]")?.textContent ?? null;
const focusedOn = (element: Element | null) =>
  element !== null && document.activeElement === element;
const ruleField = () => within(acmeItem()).queryByLabelText("Valor da regra");
const limitField = () => within(acmeItem()).queryByLabelText("Limite mensal (US$)");

describe("clients: a change to the rules says what happened and keeps the focus (#3631)", () => {
  test("removing a rule moves the focus to the remove button of the row that took its place", async () => {
    await open(acme([rule("r1", "a/*"), rule("r2", "b/*")]));
    await press("Remover regra a/*");
    expect(said()).toBe("Regra removida: a/*");
    expect(focusedOn(button("Remover regra b/*"))).toBe(true);
  });

  test("removing the last rule of the list moves the focus to the previous row", async () => {
    await open(acme([rule("r1", "a/*"), rule("r2", "b/*")]));
    await press("Remover regra b/*");
    expect(said()).toBe("Regra removida: b/*");
    expect(focusedOn(button("Remover regra a/*"))).toBe(true);
  });

  test("removing the only rule moves the focus to the rule value field", async () => {
    await open(acme([rule("r1", "a/*")]));
    await press("Remover regra a/*");
    expect(said()).toBe("Regra removida: a/*");
    expect(focusedOn(ruleField())).toBe(true);
  });

  test("moving a rule keeps the focus on the control that moved, and says the position", async () => {
    await open(acme([rule("r1", "a/*"), rule("r2", "b/*"), rule("r3", "c/*")]));
    await press("Descer regra a/*");
    expect(said()).toBe("Regra a/* movida para a posição 2 de 3");
    expect(focusedOn(button("Descer regra a/*"))).toBe(true);
  });

  test("a rule that reaches the end moves the focus to its twin, because the arrow is now disabled", async () => {
    await open(acme([rule("r1", "a/*"), rule("r2", "b/*")]));
    await press("Descer regra a/*");
    expect(said()).toBe("Regra a/* movida para a posição 2 de 2");
    expect(focusedOn(button("Subir regra a/*"))).toBe(true);
    await press("Subir regra a/*");
    expect(said()).toBe("Regra a/* movida para a posição 1 de 2");
    expect(focusedOn(button("Descer regra a/*"))).toBe(true);
  });
});

describe("clients: a change to the month limit says what happened and keeps the focus (#3631)", () => {
  const type = async (value: string) => {
    await act(async () => {
      fireEvent.change(limitField() as HTMLElement, { target: { value } });
    });
  };

  test("the limit field shows the current limit, and a save starts from it", async () => {
    const { store } = await open(acme([], { acme: 500 }));
    expect((limitField() as HTMLInputElement).value).toBe("500");
    await type("600");
    await press("Salvar orçamento");
    expect(store.clients.budgets()).toEqual({ acme: 600 });
    expect(said()).toBe("Orçamento salvo: US$ 600,00");
    expect((limitField() as HTMLInputElement).value).toBe("600");
    expect(focusedOn(limitField())).toBe(true);
  });

  test("the saved-line goes away when the next edit starts, and clearing the field is not an error", async () => {
    await open(acme([], { acme: 500 }));
    await type("600");
    await press("Salvar orçamento");
    expect(said()).toBe("Orçamento salvo: US$ 600,00");
    await type("");
    expect(said()).toBeNull();
    expect(within(acmeItem()).queryByText("Informe um limite maior que zero.")).toBeNull();
  });

  test("removing the limit moves the focus to the limit field, now empty, and says so", async () => {
    const { store } = await open(acme([], { acme: 500 }));
    await press("Remover orçamento de Acme");
    expect(store.clients.budgets()).toEqual({});
    expect(said()).toBe("Orçamento removido");
    expect((limitField() as HTMLInputElement).value).toBe("");
    expect(focusedOn(limitField())).toBe(true);
  });

  test("the two Delete buttons of a client do not share a visible name", async () => {
    await open(acme([], { acme: 500 }));
    const names = [...acmeItem().querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names.filter((name) => name === "Excluir")).toHaveLength(1);
    expect(button("Remover orçamento de Acme")?.textContent).toBe("Remover orçamento");
  });

  test("a spend that rounds to 0% does not read as 0%", async () => {
    const platform = memoryPlatform();
    const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    store.clients.add("Acme");
    const client = store.clients.list()[0] as NonNullable<ReturnType<typeof store.clients.list>[0]>;
    store.clients.setBudget(client.id, 500);
    const state = {
      clientBudgets: [{ clientId: client.id, spentUsd: 0.53, limitUsd: 500, fraction: 0.53 / 500 }],
    } as ComponentProps<typeof ClientBudget>["state"];
    render(<ClientBudget store={store} state={state} client={client} />);
    const line = document.querySelector("[data-budget-line]")?.textContent ?? "";
    expect(line).toBe("Este mês: US$ 0,53 de US$ 500,00 (menos de 1%)");
  });
});
