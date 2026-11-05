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

/**
 * Issue #170: a card opened by its route (a restored tab, a deep link, the palette) before the app
 * knows it. The card's fields must show what the card says once it arrives.
 */
async function openByRoute(lang: "en" | "pt-BR") {
  const d = makeDaemon(cleanups, {});
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
  const card = d.board.createCard(project?.id ?? "", {
    title: "Fix the total",
    description: "Sum the items and add the tax.",
  });
  await act(async () => {
    store.router.push({
      name: "card",
      host: hostId,
      projectId: project?.id ?? "",
      cardId: card.id,
    });
  });
  return { d, store, hostId, card };
}

const field = (label: string) =>
  screen.queryByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | null;
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`card-fields (${lang}): the title and description follow the card`, () => {
    test("a card opened by its route shows its title and description in the fields", async () => {
      await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      expect(field(t.cardUi.title)?.value).toBe("Fix the total");
      expect(field(t.cardUi.description)?.value).toBe("Sum the items and add the tax.");
    });

    test("Save description stays off until the description is edited, then saves the edit", async () => {
      const { d, card } = await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      expect(button(t.cardUi.saveDescription)?.disabled).toBe(true);
      await act(async () => {
        fireEvent.change(field(t.cardUi.description) as HTMLTextAreaElement, {
          target: { value: "Sum the items, add the tax and round." },
        });
      });
      expect(button(t.cardUi.saveDescription)?.disabled).toBe(false);
      await act(async () => {
        fireEvent.click(button(t.cardUi.saveDescription) as HTMLButtonElement);
      });
      await settle(
        () => d.board.getCard(card.id).description === "Sum the items, add the tax and round.",
      );
    });

    test("a save the host refuses keeps the edit in the field", async () => {
      const { store } = await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      await act(async () => {
        fireEvent.change(field(t.cardUi.description) as HTMLTextAreaElement, {
          target: { value: "My long edit." },
        });
      });
      // A refused command comes back as null (the store shows the reason in its banner).
      const real = store.hostCommand.bind(store);
      store.hostCommand = (async (hostId, type, payload) =>
        type === "card.update" ? null : real(hostId, type, payload)) as typeof store.hostCommand;
      await act(async () => {
        fireEvent.click(button(t.cardUi.saveDescription) as HTMLButtonElement);
      });
      await act(async () => {});
      expect(field(t.cardUi.description)?.value).toBe("My long edit.");
    });

    test("Save title saves the edited title, and a refused one keeps the edit", async () => {
      const { d, store, card } = await openByRoute(lang);
      await settle(() => field(t.cardUi.title)?.value === "Fix the total");
      expect(button(t.cardUi.saveTitle)?.disabled).toBe(true);
      const type = async (value: string) => {
        await act(async () => {
          fireEvent.change(field(t.cardUi.title) as HTMLInputElement, { target: { value } });
        });
        await act(async () => {
          fireEvent.click(button(t.cardUi.saveTitle) as HTMLButtonElement);
        });
      };
      await type("Fix the cart total");
      await settle(() => d.board.getCard(card.id).title === "Fix the cart total");
      const real = store.hostCommand.bind(store);
      store.hostCommand = (async (hostId, type, payload) =>
        type === "card.update" ? null : real(hostId, type, payload)) as typeof store.hostCommand;
      await type("Fix the cart total and round");
      await act(async () => {});
      expect(field(t.cardUi.title)?.value).toBe("Fix the cart total and round");
    });

    test("a change made elsewhere shows in a field the person has not touched", async () => {
      const { store, hostId, card } = await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      await store.hostCommand(hostId, "card.update", {
        cardId: card.id,
        title: "Fix the cart total",
        description: "Also round to cents.",
      });
      await settle(() => field(t.cardUi.description)?.value === "Also round to cents.");
      expect(field(t.cardUi.title)?.value).toBe("Fix the cart total");
    });

    // OpenCode branch review M1: a draft never knew which text it started from, so Save wrote a
    // stale draft over a change made elsewhere (board sync, another client).
    test("a change made elsewhere while editing stops a plain Save, says why, and Use theirs shows it", async () => {
      const { store, hostId, card } = await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      await act(async () => {
        fireEvent.change(field(t.cardUi.description) as HTMLTextAreaElement, {
          target: { value: "Sum the items and add the tax. + my line" },
        });
      });
      await store.hostCommand(hostId, "card.update", {
        cardId: card.id,
        description: "Sum the items and add the tax. + their line",
      });
      await settle(() => button(t.cardUi.saveDescription)?.disabled === true);
      expect(document.body.textContent ?? "").toContain(t.cardUi.changedElsewhere);
      await act(async () => {
        fireEvent.click(button(t.cardUi.useTheirs) as HTMLButtonElement);
      });
      expect(field(t.cardUi.description)?.value).toBe(
        "Sum the items and add the tax. + their line",
      );
    });

    test("the title stops a plain Save the same way, and Use theirs shows the title made elsewhere", async () => {
      const { store, hostId, card } = await openByRoute(lang);
      await settle(() => field(t.cardUi.title)?.value === "Fix the total");
      await act(async () => {
        fireEvent.change(field(t.cardUi.title) as HTMLInputElement, {
          target: { value: "Fix the total, mine" },
        });
      });
      await store.hostCommand(hostId, "card.update", { cardId: card.id, title: "Fix it, theirs" });
      await settle(() => button(t.cardUi.saveTitle)?.disabled === true);
      await act(async () => {
        fireEvent.click(button(t.cardUi.useTheirs) as HTMLButtonElement);
      });
      expect(field(t.cardUi.title)?.value).toBe("Fix it, theirs");
    });

    // OpenCode branch review m1: typing the card's text back is no edit any more.
    test("typing the card's own text back lets the field follow the card again", async () => {
      const { store, hostId, card } = await openByRoute(lang);
      await settle(() => button(t.cardUi.saveDescription) !== null);
      for (const value of ["x", "Sum the items and add the tax."]) {
        await act(async () => {
          fireEvent.change(field(t.cardUi.description) as HTMLTextAreaElement, {
            target: { value },
          });
        });
      }
      await store.hostCommand(hostId, "card.update", { cardId: card.id, description: "Changed." });
      await settle(() => field(t.cardUi.description)?.value === "Changed.");
    });
  });
}
