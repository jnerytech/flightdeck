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
async function openCard(lang: "en" | "pt-BR", options: { alone?: boolean } = {}) {
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
  if (!options.alone) d.board.createCard(project?.id ?? "", { title: "Cart API", description: "" });
  const card = d.board.createCard(project?.id ?? "", { title: "Cart screen", description: "" });
  await act(async () => {
    store.router.push({
      name: "card",
      host: hostId,
      projectId: project?.id ?? "",
      cardId: card.id,
    });
  });
  return { d, card, store };
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

    // #732: the reason under Add hung below the button and took no height, so when Add wrapped
    // under a wide picker it covered the next field's label. In the row's help line it is in the
    // flow, under the picker.
    test("the reason under Add a blocker is the row's help line, so it never covers the next field", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.deps.addLabel) !== null);
      const deps = screen.queryByRole("region", { name: t.deps.title }) as HTMLElement;
      const add = within(deps).queryByRole("button", { name: t.deps.add });
      const reason = document.getElementById(add?.getAttribute("aria-describedby") ?? "");
      expect({
        text: reason?.textContent ?? null,
        helpLine: reason?.classList.contains("field-help") ?? false,
        hanging: reason?.closest(".action-with-reason") != null,
      }).toEqual({ text: t.deps.pickFirst, helpLine: true, hanging: false });
    });

    // #732: Stop and Open PR are off on a card that has not started, and their reasons hung under
    // each button, printing over each other and over Discard. They are the Run row's help lines now.
    test("on a card that has not started, Stop and Open PR say why on lines of their own under the row", async () => {
      await openCard(lang);
      await settle(() => screen.queryByRole("button", { name: t.cardUi.stop }) !== null);
      const run = screen.queryByRole("region", { name: t.cardUi.runTitle }) as HTMLElement;
      const reasonOf = (name: string) => {
        const button = within(run).queryByRole("button", { name });
        const line = document.getElementById(button?.getAttribute("aria-describedby") ?? "");
        return {
          text: line?.textContent ?? null,
          helpLine: line?.classList.contains("field-help") ?? false,
          hanging: line?.closest(".action-with-reason") != null,
        };
      };
      expect({ stop: reasonOf(t.cardUi.stop), pr: reasonOf(t.cardUi.openPr) }).toEqual({
        stop: { text: t.cardUi.notRunning, helpLine: true, hanging: false },
        pr: { text: t.cardUi.needWorktree, helpLine: true, hanging: false },
      });
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

    // OpenCode branch review M1: after one blocker was added the picker showed its placeholder but
    // Add stayed on, and a click did nothing.
    test("after a blocker is added, the picker is back on its placeholder and Add is off again", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.deps.addLabel) !== null);
      const deps = screen.queryByRole("region", { name: t.deps.title }) as HTMLElement;
      const add = () =>
        within(deps).queryByRole("button", { name: t.deps.add }) as HTMLButtonElement | null;
      const picker = screen.queryByLabelText(t.deps.addLabel) as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(picker, { target: { value: picker.options[1]?.value ?? "" } });
      });
      await act(async () => {
        fireEvent.click(add() as HTMLButtonElement);
      });
      // The chain lists it (the select's option has the same text, so wait for its remove button).
      const remove = t.deps.remove.replace("{title}", "Cart API");
      await settle(() => within(deps).queryByRole("button", { name: remove }) !== null);
      expect((screen.queryByLabelText(t.deps.addLabel) as HTMLSelectElement).value).toBe("");
      expect(add()?.disabled).toBe(true);
    });

    // OpenCode branch review m1: with no other card to wait for, the reason sent the person to
    // pick something that does not exist.
    test("with no other card to wait for, the picker is off and says so", async () => {
      await openCard(lang, { alone: true });
      await settle(() => screen.queryByLabelText(t.deps.addLabel) !== null);
      const picker = screen.queryByLabelText(t.deps.addLabel) as HTMLSelectElement;
      expect(picker.disabled).toBe(true);
      expect(document.body.textContent ?? "").toContain(t.deps.noneToPick);
    });

    // OpenCode branch review M2: the adjust box and the workflow fields had only an aria-label,
    // and the blockers sat above the Details panel.
    // #732: Run came last, so a card that had not started opened with Start below an 800 px
    // window. The card's next step comes first now; Details and Blocked by follow it.
    test("every field on the card screen has a visible label, and the panels read Run, Details, Blocked by", async () => {
      await openCard(lang);
      await settle(() => screen.queryByLabelText(t.cardUi.description) !== null);
      const unlabelled = [
        ...document.querySelectorAll<HTMLElement>("main input, main select, main textarea"),
      ]
        .filter((el) => (el as HTMLInputElement).type !== "checkbox" || !el.closest("label"))
        .filter((el) => !el.id || !document.querySelector(`label[for="${el.id}"]`))
        .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.tagName);
      expect(unlabelled).toEqual([]);
      const order = [...document.querySelectorAll("main section[aria-label]")]
        .map((el) => el.getAttribute("aria-label"))
        .filter((name) =>
          [t.cardUi.detailsTitle, t.deps.title, t.cardUi.runTitle].includes(name ?? ""),
        );
      expect(order).toEqual([t.cardUi.runTitle, t.cardUi.detailsTitle, t.deps.title]);
    });
  });
}

// Issue #78, slice 3a: the validation note and the question before starting.
describe("card-form (en): the validation note and starting a card with no criteria", () => {
  test("the validation note is a labelled field that saves on the card, and clears with empty text", async () => {
    const { d, card, store } = await openCard("en");
    await settle(() => screen.queryByLabelText("Description") !== null);
    expect(screen.queryByLabelText("Validation note") === null).toBe(false);
    const field = screen.getByLabelText("Validation note") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(field, { target: { value: "  Ran it by hand on the staging data.  " } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save validation note" }));
    });
    await settle(() => d.board.getCard(card.id).validationNote !== null);
    expect(d.board.getCard(card.id).validationNote).toBe("Ran it by hand on the staging data.");
    // The field follows the card again once the host's update has reached the screen.
    await settle(() =>
      Object.values(store.getState().cards).some((c) => c.validationNote !== null),
    );
    await act(async () => {
      fireEvent.change(field, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save validation note" }));
    });
    await settle(() => d.board.getCard(card.id).validationNote === null);
  });

  /** The app's view of the host with the card's project asking (or not) about criteria on Start. */
  async function watchStarts(asking: boolean) {
    const { d, card, store } = await openCard("en");
    const sent: string[] = [];
    // The host is not asked to run a card here: what the app sends is what is checked.
    const forward = store.hostCommand.bind(store);
    store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
      if (type !== "card.start") return forward(hostId, type as never, payload as never);
      sent.push((payload as { cardId: string }).cardId);
      return {};
    }) as never;
    if (asking) {
      const project = d.board.updateProject(card.projectId, {
        contractByColumn: { in_progress: { enforce: "confirm", checks: ["criteria"] } },
      });
      store.rememberProjects(store.getState().hosts[0]?.id ?? "", [project]);
    }
    await settle(() => screen.queryByRole("button", { name: "Start" }) !== null);
    const start = () =>
      act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Start" }));
      });
    return { card, sent, start };
  }

  test("by default Start asks nothing: the card starts at once", async () => {
    const { card, sent, start } = await watchStarts(false);
    await start();
    await settle(() => sent.length > 0 || screen.queryByRole("alertdialog") !== null);
    expect(screen.queryByRole("alertdialog") === null).toBe(true);
    expect(sent).toEqual([card.id]);
  });

  test("where In progress confirms criteria, Start asks first; Cancel starts nothing, Start anyway starts the card", async () => {
    const { card, sent, start } = await watchStarts(true);
    await start();
    await settle(() => sent.length > 0 || screen.queryByRole("alertdialog") !== null);
    expect(screen.queryByRole("alertdialog") === null).toBe(false);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("acceptance criteria");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(screen.queryByRole("alertdialog") === null).toBe(true);
    expect(sent).toEqual([]);
    await start();
    await settle(() => screen.queryByRole("alertdialog") !== null);
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start anyway" }),
      );
    });
    await settle(() => sent.length === 1);
    expect(sent).toEqual([card.id]);
  });
});
