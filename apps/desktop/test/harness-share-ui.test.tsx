import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ProjectLoad } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { HarnessShare } = await import("../src/components/projects/harness-share.tsx");
const { HarnessPanel } = await import("../src/components/projects/harness-panel.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #75, slice T2: the project's Claude Code setup card shares its Markdown files as a host
 * template. The person names it; the app sends the path, an id made from the name, and the title.
 */
const LOAD: ProjectLoad = {
  path: "/work/api",
  hooks: [],
  mcpServers: [],
  envKeys: [],
  allowRules: [],
  defaultMode: null,
  agents: [],
  skills: [],
  commands: [],
  claudeMd: true,
  executables: [],
  redirects: [],
  plugins: [],
  otherKeys: [],
  extras: [],
  unreadable: [],
  omitted: { hooks: 0, mcpServers: 0, allowRules: 0, envKeys: 0 },
};
type Answer =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      reason?: string;
      params?: Record<string, string>;
    };

function setup(
  options: {
    language?: "en" | "pt-BR";
    answer?: Answer;
    afterwards?: Array<Answer | Promise<Answer>>;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  const later = [...(options.afterwards ?? [])];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    const next = sent.length > 1 ? later.shift() : undefined;
    return (
      next ??
      options.answer ?? {
        ok: true,
        data: {
          id: "shop-setup",
          title: "Shop setup",
          files: ["CLAUDE.md", "agents/a.md"],
          bytes: 9,
        },
      }
    );
  }) as never;
  const view = <HarnessShare store={store} hostId="h1" path="/work/api" />;
  return { store, view, sent };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const dialog = () => screen.queryByRole("alertdialog") as HTMLElement | null;
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}
async function open(label: string) {
  await settle(() => button(label) !== null, 5000, "the share button");
  await click(button(label));
  await settle(() => dialog() !== null, 5000, "the share dialog");
}
const nameField = (label: string) =>
  within(dialog() as HTMLElement).queryByLabelText(label) as HTMLInputElement | null;
async function type(label: string, value: string) {
  const field = nameField(label);
  if (field) await act(async () => fireEvent.change(field, { target: { value } }));
  return field !== null;
}
const confirm = (name: string) =>
  within(dialog() as HTMLElement).queryByRole("button", { name }) as HTMLButtonElement | null;

describe("harness-share-ui: the setup card shares the project's Markdown as a host template (#75)", () => {
  test("the dialog names what is copied and what never is, and Share waits for a name with a letter or a digit", async () => {
    const { view } = setup();
    render(view);
    await open("Share as template");
    const says = dialog()?.textContent ?? "";
    const before = confirm("Share")?.disabled;
    await type("Template name", "!!!");
    const symbols = confirm("Share")?.disabled;
    await type("Template name", "Shop setup");
    expect([
      says.includes("CLAUDE.md, agents and skills"),
      says.includes("never hooks, permissions or MCP servers"),
      before,
      symbols,
      confirm("Share")?.disabled,
    ]).toEqual([true, true, true, true, false]);
  });

  test("the dialog says the id the name becomes, and why a name with no letter or digit cannot be shared", async () => {
    const { view } = setup();
    render(view);
    await open("Share as template");
    await type("Template name", "Shop setup");
    const hint = dialog()?.textContent?.includes("Saved as shop-setup.");
    await type("Template name", "日本語");
    expect([
      hint,
      dialog()?.textContent?.includes("Use at least one letter or digit (a-z, 0-9)."),
    ]).toEqual([true, true]);
  });

  test("the name field has the focus when the dialog opens, and Enter shares", async () => {
    const { view, sent } = setup();
    render(view);
    await open("Share as template");
    const focused = await settleMaybe(
      () => document.activeElement === nameField("Template name"),
      2000,
    );
    await type("Template name", "Shop setup");
    const field = nameField("Template name");
    if (field) await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await settle(() => sent.length === 1, 5000, "the export sent by Enter");
    expect(focused).toBe(true);
  });

  test("Enter does nothing while the name has no letter or digit", async () => {
    const { view, sent } = setup();
    render(view);
    await open("Share as template");
    await type("Template name", "!!!");
    const field = nameField("Template name");
    if (field) await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await uiIdle();
    expect(sent).toHaveLength(0);
  });

  test("an older answer is gone when the next attempt starts", async () => {
    // The second answer never comes: what is on screen meanwhile is what the next attempt left.
    const { view, sent } = setup({ afterwards: [new Promise<Answer>(() => {})] });
    render(view);
    await open("Share as template");
    await type("Template name", "Shop setup");
    await click(confirm("Share"));
    await settle(
      () => screen.queryByText("Shared as the template Shop setup (2 files).") !== null,
      5000,
      "the first answer",
    );
    await click(button("Share as template"));
    await settle(() => dialog() !== null, 5000, "the dialog again");
    await type("Template name", "Other");
    await click(confirm("Share"));
    await settle(() => sent.length === 2, 5000, "the second export");
    await settle(
      () => screen.queryByText("Shared as the template Shop setup (2 files).") === null,
      5000,
      "the first answer cleared",
    );
  });

  test("sharing sends the path, an id made from the name and the title, then says what was shared", async () => {
    const { view, sent } = setup();
    render(view);
    await open("Share as template");
    await type("Template name", "Shop setup");
    await click(confirm("Share"));
    await settle(() => sent.length === 1, 5000, "the export sent");
    await settle(
      () => screen.queryByText("Shared as the template Shop setup (2 files).") !== null,
      5000,
      "the answer",
    );
    expect(sent).toEqual([
      ["project.harness.export", { path: "/work/api", id: "shop-setup", title: "Shop setup" }],
    ]);
  });

  test("a refusal is said as an alert, with the host's reason", async () => {
    const { view } = setup({
      answer: {
        ok: false,
        code: "invalid_state",
        message: "the template shop-setup is already there",
        reason: "harness_template_taken",
        params: { id: "shop-setup" },
      },
    });
    render(view);
    await open("Share as template");
    await type("Template name", "Shop setup");
    await click(confirm("Share"));
    const said = await settleMaybe(
      () =>
        screen.queryByRole("alert")?.textContent ===
        "A template named shop-setup is already on this host: pick another name.",
    );
    expect(said).toBe(true);
  });

  test("it reads in Portuguese too", async () => {
    const { view } = setup({ language: "pt-BR" });
    render(view);
    await open("Compartilhar como modelo");
    const shown = nameField("Nome do modelo") !== null;
    await uiIdle();
    expect([shown, confirm("Compartilhar") !== null]).toEqual([true, true]);
  });

  test("the setup card offers it only when it is handed the share", async () => {
    const { store } = setup();
    const t = store.i18n.t;
    render(<HarnessPanel load={LOAD} t={t} share={{ store, hostId: "h1", path: "/work/api" }} />);
    const offered = await settleMaybe(() => button("Share as template") !== null);
    cleanup();
    render(<HarnessPanel load={LOAD} t={t} />);
    await uiIdle();
    expect([offered, button("Share as template") !== null]).toEqual([true, false]);
  });
});
