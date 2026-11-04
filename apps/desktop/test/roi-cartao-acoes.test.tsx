import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

/** A host with a project and one card, with the card open. */
async function openCard(lang: "en" | "pt-BR", options: Parameters<typeof makeDaemon>[1]) {
  const d = makeDaemon(cleanups, options);
  const repo = join(d.root, "shop");
  mkdirSync(repo, { recursive: true });
  await Bun.spawn(["git", "init", "-q", repo]).exited;
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  const project = await store.hostCommand(hostId, "project.add", { path: repo });
  const card = d.board.createCard(project?.id ?? "", { title: "ship it", description: "" });
  await act(async () => {
    store.router.push({
      name: "card",
      host: hostId,
      projectId: project?.id ?? "",
      cardId: card.id,
    });
  });
  return { d, card };
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`roi-cartao-acoes (${lang}): the card's hours`, () => {
    test("the hours field saves through card.update, and an empty field clears it", async () => {
      const { d, card } = await openCard(lang, { roi: true });
      await settle(() => screen.queryByLabelText(t.roiUi.cardHours) !== null);
      const field = screen.getByLabelText(t.roiUi.cardHours) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(field, { target: { value: "3.5" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t.roiUi.cardHoursSave }));
      });
      await settle(() => d.board.getCard(card.id).estimateHours === 3.5);
      await act(async () => {
        fireEvent.change(field, { target: { value: "" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t.roiUi.cardHoursSave }));
      });
      await settle(() => d.board.getCard(card.id).estimateHours === null);
    });

    test("a text that is not a number saves nothing", async () => {
      const { d, card } = await openCard(lang, { roi: true });
      await settle(() => screen.queryByLabelText(t.roiUi.cardHours) !== null);
      await act(async () => {
        fireEvent.change(screen.getByLabelText(t.roiUi.cardHours), { target: { value: "abc" } });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: t.roiUi.cardHoursSave }));
      });
      await act(async () => {});
      expect(d.board.getCard(card.id).estimateHours).toBeNull();
    });

    test("a host without roi shows no hours field", async () => {
      await openCard(lang, {});
      await settle(() => screen.queryByLabelText(t.cardUi.description) !== null);
      expect(screen.queryByLabelText(t.roiUi.cardHours)).toBeNull();
    });
  });
}
