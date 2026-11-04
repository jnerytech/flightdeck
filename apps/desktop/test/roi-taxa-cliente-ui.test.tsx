import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

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
const settle = waiter(10_000);

async function clientsPage(lang: "en" | "pt-BR", options: Parameters<typeof makeDaemon>[1]) {
  const d = makeDaemon(cleanups, options);
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const made = store.clients.add("Acme");
  store.clients.addRule(made?.id ?? "", { kind: "folder", path: d.root });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await act(async () => {
    store.router.push({ name: "clients" });
  });
  return { store, clientId: made?.id ?? "" };
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`roi-taxas-ui (${lang}): the hourly rate of a client`, () => {
    test("the rate of a client is saved, replaced and cleared", async () => {
      const { store, clientId } = await clientsPage(lang, { roi: true });
      await settle(() => screen.queryByLabelText(t.roiUi.clientRate.label) !== null);
      const field = () => screen.getByLabelText(t.roiUi.clientRate.label);
      const save = async (value: string) => {
        await act(async () => {
          fireEvent.change(field(), { target: { value } });
        });
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: t.roiUi.clientRate.save }));
        });
      };
      await save("35");
      expect(store.roi.data().clientRates[clientId]).toBe(35);
      await save("40.5");
      expect(store.roi.data().clientRates[clientId]).toBe(40.5);
      await save("");
      expect(store.roi.data().clientRates[clientId]).toBeUndefined();
    });

    test("a text that is not a number is refused and nothing is saved", async () => {
      const { store, clientId } = await clientsPage(lang, { roi: true });
      await settle(() => screen.queryByLabelText(t.roiUi.clientRate.label) !== null);
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t.roiUi.clientRate.label), {
          target: { value: "abc" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t.roiUi.clientRate.save }));
      });
      expect(screen.queryByText(t.roiUi.clientRate.invalid)).not.toBeNull();
      expect(store.roi.data().clientRates[clientId]).toBeUndefined();
    });

    test("a host without roi shows no rate field", async () => {
      await clientsPage(lang, {});
      await settle(() => screen.queryByText("Acme") !== null);
      expect(screen.queryByLabelText(t.roiUi.clientRate.label)).toBeNull();
    });
  });
}
