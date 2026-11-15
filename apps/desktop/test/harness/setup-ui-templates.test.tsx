import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HarnessPreview } from "@flightdeck/protocol";
import { settleMaybe, uiIdle } from "../wait.ts";
import {
  ALL,
  type Answer,
  act,
  cleanup,
  click,
  dialogText,
  FEATURES,
  fireEvent,
  listing,
  open,
  PREVIEW,
  render,
  SETTINGS,
  screen,
  setup,
} from "./setup-ui-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("harness-setup-ui-templates: the set-up dialog can start from one of the host's templates (#75)", () => {
  const SHOP = { id: "shop", title: "Shop setup", files: ["CLAUDE.md", "agents/a.md"], bytes: 90 };
  const FROM_TEMPLATE: HarnessPreview = {
    ...PREVIEW,
    withheld: [
      { path: ".claude/agents/runner.md", reason: "frontmatter" },
      { path: "CLAUDE.md", reason: "import" },
    ],
  };
  const TEMPLATE_FEATURES = [...FEATURES, "harnessTemplates", "harnessDraft"];
  const startFrom = () => screen.queryByLabelText("Start from") as HTMLSelectElement | null;
  const choose = async (value: string) => {
    const select = startFrom();
    if (select) await act(async () => fireEvent.change(select, { target: { value } }));
    return select !== null;
  };

  test("the choice is there only on a host with templates, and only when it has one", async () => {
    const withOne = setup({ features: TEMPLATE_FEATURES, templates: [SHOP] });
    render(withOne.view);
    await listing();
    const offered = await settleMaybe(() => startFrom() !== null);
    const options = [...(startFrom()?.options ?? [])].map((option) => option.textContent);
    cleanup();
    const none = setup({ features: TEMPLATE_FEATURES, templates: [] });
    render(none.view);
    await listing();
    await uiIdle();
    const noneOffered = startFrom() !== null;
    cleanup();
    const older = setup({ templates: [SHOP] });
    render(older.view);
    await listing();
    await uiIdle();
    expect([offered, options, noneOffered, startFrom() !== null]).toEqual([
      true,
      ["Flightdeck's own files", "Shop setup"],
      false,
      false,
    ]);
  });

  test("the built-in choice sends no template, the host's sends its id with preview and apply", async () => {
    const { view, sent } = setup({
      features: TEMPLATE_FEATURES,
      templates: [SHOP],
      preview: FROM_TEMPLATE,
      trusted: true,
    });
    render(view);
    await listing();
    await settleMaybe(() => startFrom() !== null);
    await open();
    // The dialog frame reads pt-BR when nothing provides the translator, as in the other tests here.
    await click("Cancelar", true);
    await uiIdle();
    await choose("shop");
    await open();
    await click("Apply the setup", true);
    await settleMaybe(() => sent.some(([type]) => type === "project.harness.apply"));
    const previews = sent.filter(([type]) => type === "project.harness.preview").map(([, p]) => p);
    const apply = sent.find(([type]) => type === "project.harness.apply")?.[1];
    expect([previews, apply]).toEqual([
      [
        { path: "/work/api", parts: ALL },
        { path: "/work/api", parts: ALL, template: "shop" },
      ],
      {
        path: "/work/api",
        parts: ALL,
        digests: { [SETTINGS]: "d-settings", "CLAUDE.md": "d-claude" },
        confirm: true,
        template: "shop",
      },
    ]);
  });

  test("the dialog lists what the template left out with the reason, and offers no CLAUDE.md draft", async () => {
    const { view } = setup({
      features: TEMPLATE_FEATURES,
      templates: [SHOP],
      preview: FROM_TEMPLATE,
    });
    render(view);
    await listing();
    await settleMaybe(() => startFrom() !== null);
    await choose("shop");
    const opened = await open();
    const says = dialogText();
    expect([
      opened,
      says.includes("Left out of the template"),
      says.includes(
        ".claude/agents/runner.md: its front matter could run a command or grant a permission",
      ),
      says.includes("CLAUDE.md: it imports a file from outside the project"),
      says.includes("Draft with Claude"),
    ]).toEqual([true, true, true, true, false]);
  });

  test("it reads in Portuguese", async () => {
    const { view } = setup({
      language: "pt-BR",
      features: TEMPLATE_FEATURES,
      templates: [SHOP],
      preview: FROM_TEMPLATE,
    });
    render(view);
    await listing("O que este projeto carregaria");
    const offered = await settleMaybe(() => screen.queryByLabelText("Partir de") !== null);
    const select = screen.queryByLabelText("Partir de") as HTMLSelectElement | null;
    if (select) await act(async () => fireEvent.change(select, { target: { value: "shop" } }));
    await click("Configurar o Claude Code");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    expect([
      offered,
      [...(select?.options ?? [])].map((option) => option.textContent),
      dialogText().includes("Deixado de fora do modelo"),
    ]).toEqual([true, ["Arquivos do próprio Flightdeck", "Shop setup"], true]);
  });

  test("a template that is gone when the preview is asked drops the choice back to Flightdeck's own files", async () => {
    const { view, sent } = setup({
      features: TEMPLATE_FEATURES,
      templates: [SHOP],
      laterTemplates: [[]],
      previewRefusesTemplate: true,
    });
    render(view);
    await listing();
    await settleMaybe(() => startFrom() !== null);
    await choose("shop");
    await click("Set up Claude Code");
    await settleMaybe(() => startFrom() === null, 3000);
    const choiceGone = startFrom() === null;
    await click("Set up Claude Code");
    await settleMaybe(() => screen.queryByRole("alertdialog") !== null);
    const previews = sent.filter(([type]) => type === "project.harness.preview").map(([, p]) => p);
    expect([choiceGone, previews]).toEqual([
      true,
      [
        { path: "/work/api", parts: ALL, template: "shop" },
        { path: "/work/api", parts: ALL },
      ],
    ]);
  });

  test("a template that is gone when apply is asked is dropped from the choice, and the list is read again", async () => {
    const gone: Answer = {
      ok: false,
      code: "invalid_state",
      message: "there is no template shop",
      reason: "harness_template_missing",
      params: { id: "shop" },
    };
    const { view, sent } = setup({
      features: TEMPLATE_FEATURES,
      templates: [SHOP],
      laterTemplates: [[], []],
      preview: FROM_TEMPLATE,
      answers: [gone],
      trusted: true,
    });
    render(view);
    await listing();
    await settleMaybe(() => startFrom() !== null);
    await choose("shop");
    await open();
    await click("Apply the setup", true);
    const alerted = await settleMaybe(() =>
      screen.queryAllByRole("alert").some((alert) => alert.textContent?.includes("pick another")),
    );
    await settleMaybe(() => startFrom() === null, 3000);
    expect([
      alerted,
      startFrom() === null,
      sent.filter(([type]) => type === "harness.templates.list").length >= 2,
    ]).toEqual([true, true, true]);
  });
});
