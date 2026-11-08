import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HarnessTemplateInfo } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { HarnessTemplatesSection } = await import("../src/ui/HarnessTemplatesSection.tsx");

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
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  let templates = [...(options.templates ?? [SHOP, SOLO])];
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "harness.templates.list") return { templates };
    if (type === "harness.templates.delete") {
      if (options.delete === "refused") return null;
      const { id } = payload as { id: string };
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
  return { view, sent, deletes };
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
    const english = [shown("Solo"), shown("2 files · 2.0 KB"), shown("1 file · 100 B")];
    cleanup();
    const pt = setup({ language: "pt-BR" });
    render(pt.view);
    await settle(() => shown("Shop setup"), 5000, "the Portuguese listing");
    expect([...english, shown("2 arquivos · 2.0 KB"), shown("1 arquivo · 100 B")]).toEqual([
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
    ]).toEqual([true, 0, [["harness.templates.delete", { id: "shop", confirm: true }]], true]);
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
