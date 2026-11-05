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

/** A card with a sibling it could wait for, open on a host with costs per card (roi). */
async function openCard(lang: "en" | "pt-BR") {
  const d = makeDaemon(cleanups, { roi: true });
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
  d.board.createCard(project?.id ?? "", { title: "Cart API", description: "" });
  const card = d.board.createCard(project?.id ?? "", { title: "Cart screen", description: "" });
  await act(async () => {
    store.router.push({
      name: "card",
      host: hostId,
      projectId: project?.id ?? "",
      cardId: card.id,
    });
  });
}

/** The visible `<label>` tied to a control found by its name, or why there is none. */
function visibleLabel(name: string): string {
  const control = screen.queryByLabelText(name);
  if (!control) return `no control named "${name}"`;
  const label = control.id ? document.querySelector(`label[for="${control.id}"]`) : null;
  return label?.textContent ?? `"${name}" has no visible label`;
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`card-form (${lang}): every field of a card has a visible label, in sections`, () => {
    // Issue #174: the fields had only an aria-label, so a person saw a row of empty boxes.
    test("title, description, hours, workflow and the blocker fields show their labels", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.cardUi.description) !== null);
      for (const name of [
        t.cardUi.title,
        t.cardUi.description,
        t.roiUi.cardHours,
        t.cardUi.workflow,
        t.deps.addLabel,
        t.deps.whenLabel,
      ]) {
        expect(visibleLabel(name)).toBe(name);
      }
    });

    test("the blocker picker says what to do before a card is chosen", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.deps.addLabel) !== null);
      const picker = screen.queryByLabelText(t.deps.addLabel) as HTMLSelectElement | null;
      expect(picker?.options[0]?.textContent).toBe(t.deps.pick);
    });

    // OpenCode review R10: Add with nothing picked did nothing, silently.
    test("Add a blocker is off with a reason until a card is picked", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.deps.addLabel) !== null);
      const deps = screen.queryByRole("region", { name: t.deps.title }) as HTMLElement;
      const add = () =>
        within(deps).queryByRole("button", { name: t.deps.add }) as HTMLButtonElement | null;
      expect(add()?.disabled).toBe(true);
      const reason = add()?.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(reason)?.textContent).toBe(t.deps.pickFirst);
      const picker = screen.queryByLabelText(t.deps.addLabel) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(picker, { target: { value: picker.options[1]?.value ?? "" } });
      });
      expect(add()?.disabled).toBe(false);
    });

    test("the fields sit in a Details section and the start controls in a Run section", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.cardUi.description) !== null);
      const details = screen.queryByRole("region", { name: t.cardUi.detailsTitle });
      const run = screen.queryByRole("region", { name: t.cardUi.runTitle });
      expect(details?.contains(screen.queryByLabelText(t.cardUi.title))).toBe(true);
      expect(details?.contains(screen.queryByLabelText(t.roiUi.cardHours))).toBe(true);
      expect(run?.contains(screen.queryByLabelText(t.cardUi.workflow))).toBe(true);
      expect(run?.contains(screen.queryByRole("button", { name: t.cardUi.start }))).toBe(true);
    });
  });
}
