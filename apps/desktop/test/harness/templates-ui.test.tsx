import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HarnessTemplateInfo } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, settleMaybe, uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { TContext } = await import("../../src/i18n/context.tsx");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HarnessTemplatesSection } = await import(
  "../../src/features/harness/templates-section.tsx"
);

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #75, slice T2: the host's Claude Code setup templates are listed on the host page, and one
 * is deleted only after the person confirmed. The app sends the id and `confirm: true`, nothing else.
 */
const SHOP: HarnessTemplateInfo = {
  id: "shop",
  title: "Shop setup",
  files: ["CLAUDE.md", "agents/reviewer.md"],
  bytes: 2048,
};
const SOLO: HarnessTemplateInfo = { id: "solo", title: "Solo", files: ["CLAUDE.md"], bytes: 100 };

function setup(
  options: {
    language?: "en" | "pt-BR";
    templates?: HarnessTemplateInfo[];
    delete?: "ok" | "refused";
    /** The first listing fails (the host does not answer), the next ones work. */
    listFailsOnce?: boolean;
    /** The first listing never answers. */
    listHangs?: boolean;
    /** The delete waits until `release()` is called. */
    holdDelete?: boolean;
    /** The delete is refused, but another session had already removed the template. */
    refusedAlreadyGone?: boolean;
    /** Every listing after a delete fails (the host went away meanwhile). */
    listFailsAfterDelete?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  let templates = [...(options.templates ?? [SHOP, SOLO])];
  const sent: Array<[string, unknown, unknown]> = [];
  let listFailed = false;
  let deleted = false;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.hostCommand = (async (_host: string, type: string, payload: unknown, asked?: unknown) => {
    sent.push([type, payload, asked]);
    if (type === "harness.templates.list") {
      if (options.listHangs) return new Promise(() => undefined);
      if (options.listFailsAfterDelete && deleted) return null;
      if (options.listFailsOnce && !listFailed) {
        listFailed = true;
        return null;
      }
      return { templates };
    }
    if (type === "harness.templates.delete") {
      if (options.holdDelete) await gate;
      if (options.refusedAlreadyGone) {
        templates = templates.filter((template) => template.id !== (payload as { id: string }).id);
        return null;
      }
      if (options.delete === "refused") return null;
      const { id } = payload as { id: string };
      deleted = true;
      templates = templates.filter((template) => template.id !== id);
      return { id };
    }
    return null;
  }) as never;
  // App provides the translator of the language in use; a bare render gets pt-BR.
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <HarnessTemplatesSection store={store} hostId="h1" />
    </TContext.Provider>
  );
  const deletes = () => sent.filter(([type]) => type === "harness.templates.delete");
  return { view, sent, deletes, release: () => release() };
}

const shown = (text: string) => screen.queryByText(text) !== null;
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}
const dialog = () => screen.queryByRole("alertdialog") as HTMLElement | null;

describe("harness-templates-ui: the host lists its Claude Code setup templates and deletes one after a confirmation (#75)", () => {
  test("each template shows its title, its files and its size, in both languages", async () => {
    const en = setup();
    render(en.view);
    await settle(() => shown("Shop setup"), 5000, "the English listing");
    const english = [shown("Solo"), shown("2 files · 2 KB"), shown("1 file · 100 B")];
    cleanup();
    const pt = setup({ language: "pt-BR" });
    render(pt.view);
    await settle(() => shown("Shop setup"), 5000, "the Portuguese listing");
    expect([...english, shown("2 arquivos · 2 KB"), shown("1 arquivo · 100 B")]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test("a host with no template says how to make one", async () => {
    const { view } = setup({ templates: [] });
    render(view);
    const said = await settleMaybe(() =>
      shown("No templates yet. Share a project's setup to make one."),
    );
    expect(said).toBe(true);
  });

  test("Delete asks first: cancelling sends nothing, confirming sends the id with confirm and the list drops it", async () => {
    const { view, deletes } = setup();
    render(view);
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    const says = dialog()?.textContent ?? "";
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Cancel" }));
    await uiIdle();
    const afterCancel = deletes().length;
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation again");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settle(() => !shown("Shop setup"), 5000, "the template gone from the list");
    expect([
      says.includes("Delete the template Shop setup?"),
      afterCancel,
      deletes(),
      shown("Solo"),
    ]).toEqual([
      true,
      0,
      [["harness.templates.delete", { id: "shop", confirm: true }, { retry: false }]],
      true,
    ]);
  });

  test("Cancel gives the focus back to the Delete button that opened the dialog", async () => {
    const { view } = setup();
    render(view);
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Cancel" }));
    await settle(
      () => document.activeElement?.getAttribute("aria-label") === "Delete template Shop setup",
      5000,
      "the focus back on the Delete button",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete template Shop setup");
  });

  test("a listing that fails says so and offers to try again, instead of looking for ever", async () => {
    const { view } = setup({ listFailsOnce: true });
    render(view);
    await settle(() => shown("Could not load the templates."), 5000, "the failure note");
    const looking = shown("Looking for templates…");
    await click(button("Try again"));
    await settle(() => shown("Shop setup"), 5000, "the listing after trying again");
    expect([looking, shown("Could not load the templates.")]).toEqual([false, false]);
  });

  test("a confirmed delete puts the focus on the next row's Delete button", async () => {
    const { view } = setup();
    render(view);
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settleMaybe(
      () =>
        !shown("Shop setup") &&
        document.activeElement?.getAttribute("aria-label") === "Delete template Solo",
    );
    expect(shown("Shop setup")).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete template Solo");
  });

  test("deleting the last row puts the focus on the line that says the list is empty", async () => {
    const { view } = setup({ templates: [SOLO] });
    render(view);
    await settle(() => button("Delete template Solo") !== null, 5000, "the Delete button");
    await click(button("Delete template Solo"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    const said = "No templates yet. Share a project's setup to make one.";
    await settleMaybe(() => shown(said) && document.activeElement?.textContent === said);
    expect(document.activeElement?.textContent).toBe(said);
  });

  test("a refused delete puts the focus back on that row's Delete button", async () => {
    const { view, deletes } = setup({ delete: "refused" });
    render(view);
    await settle(() => button("Delete template Solo") !== null, 5000, "the Delete button");
    await click(button("Delete template Solo"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settle(() => deletes().length === 1, 5000, "the delete sent");
    await uiIdle();
    await settleMaybe(
      () => document.activeElement?.getAttribute("aria-label") === "Delete template Solo",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete template Solo");
  });

  test("a refused delete of a row another session already removed still keeps the focus in the list", async () => {
    const { view, deletes } = setup({ refusedAlreadyGone: true });
    render(view);
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settle(() => deletes().length === 1, 5000, "the delete sent");
    await uiIdle();
    await settleMaybe(
      () => document.activeElement?.getAttribute("aria-label") === "Delete template Solo",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete template Solo");
  });

  test("a focus the person moved while the delete was under way is left where it is", async () => {
    const { view, release } = setup({ holdDelete: true });
    render(
      <>
        {view}
        <button type="button">Elsewhere</button>
      </>,
    );
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await uiIdle();
    await act(async () => (button("Elsewhere") as HTMLElement).focus());
    await act(async () => release());
    await settle(() => !shown("Shop setup"), 5000, "the template gone from the list");
    await uiIdle();
    expect(document.activeElement?.textContent).toBe("Elsewhere");
  });

  test("the wait for the host is a status and a failed listing is an alert", async () => {
    const waiting = setup({ listHangs: true });
    render(waiting.view);
    await uiIdle();
    const status = screen.queryByRole("status")?.textContent;
    cleanup();
    const failing = setup({ listFailsOnce: true });
    render(failing.view);
    await settleMaybe(() => shown("Could not load the templates."));
    expect([status, screen.queryByRole("alert")?.textContent]).toEqual([
      "Looking for templates…",
      "Could not load the templates.",
    ]);
  });

  test("a listing that fails after a delete hides the list it can no longer vouch for", async () => {
    const { view } = setup({ listFailsAfterDelete: true });
    render(view);
    await settle(() => button("Delete template Shop setup") !== null, 5000, "the Delete button");
    await click(button("Delete template Shop setup"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settleMaybe(() => shown("Could not load the templates."));
    expect([shown("Could not load the templates."), shown("Solo"), shown("Shop setup")]).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("a refused delete leaves the template in the list", async () => {
    const { view, deletes } = setup({ delete: "refused" });
    render(view);
    await settle(() => button("Delete template Solo") !== null, 5000, "the Delete button");
    await click(button("Delete template Solo"));
    await settle(() => dialog() !== null, 5000, "the confirmation");
    await click(within(dialog() as HTMLElement).queryByRole("button", { name: "Delete template" }));
    await settle(() => deletes().length === 1, 5000, "the delete sent");
    await uiIdle();
    expect([shown("Solo"), shown("Shop setup")]).toEqual([true, true]);
  });
});
