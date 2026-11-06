import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ModelOption } from "@flightdeck/protocol";
import { AXE_RUN_OPTIONS, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ModelPicker } = await import("../src/components/assistant/model-picker.tsx");
const axe = (await import("axe-core")).default;

setDefaultTimeout(30_000);
afterEach(cleanup);

const OPTIONS: ModelOption[] = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", group: "Haiku" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", group: "Sonnet", supportsEffort: true },
  {
    id: "meta/llama-4",
    label: "Llama 4",
    group: "meta",
    promptPerMTok: 0.2,
    completionPerMTok: 0.6,
  },
];

function setup(
  props: Partial<Parameters<typeof ModelPicker>[0]> = {},
  lang: "en" | "pt-BR" = "en",
) {
  const changes: Array<string | null> = [];
  const efforts: string[] = [];
  const retries: number[] = [];
  const view = (value: string | null, over: Partial<Parameters<typeof ModelPicker>[0]> = {}) => (
    <ModelPicker
      t={translator(lang)}
      label="Quick model"
      defaultLabel="Provider default"
      options={OPTIONS}
      value={value}
      onChange={(id) => void changes.push(id)}
      onRetry={() => void retries.push(1)}
      {...props}
      {...over}
    />
  );
  const result = render(view(null));
  return { changes, efforts, retries, view, rerender: result.rerender };
}

const option = (name: string | RegExp) => screen.queryByRole("option", { name });
const search = () => screen.getByRole("combobox", { name: "Quick model" }) as HTMLInputElement;
const type = (value: string) =>
  act(async () => {
    fireEvent.change(search(), { target: { value } });
  });
const key = (name: string) =>
  act(async () => {
    fireEvent.keyDown(search(), { key: name });
  });

describe("model-picker: one list of models for every provider", () => {
  test("a default row first, then the models grouped, the chosen one marked", () => {
    const { view, rerender } = setup();
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names[0]).toBe("Provider default");
    expect(names.slice(1).map((n) => n?.split(" ")[0])).toEqual(["Haiku", "Sonnet", "Llama"]);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Haiku",
      "Sonnet",
      "meta",
    ]);
    expect(option("Provider default")?.getAttribute("aria-selected")).toBe("true");
    rerender(view("claude-sonnet-5-5"));
    expect(option("Provider default")?.getAttribute("aria-selected")).toBe("false");
    expect(option(/Sonnet 5.5/)?.getAttribute("aria-selected")).toBe("true");
  });

  test("a model with a price shows it per million tokens; one without shows none", () => {
    setup();
    expect(option(/Llama 4/)?.textContent).toContain("$0.2 in / $0.6 out per million tokens");
    expect(option(/Haiku/)?.textContent).not.toContain("per million");
  });

  test("typing filters by name or id and drops the empty groups; nothing found says so", async () => {
    setup();
    await type("llama");
    expect(screen.getAllByRole("option").map((o) => o.textContent?.split(" ")[0])).toEqual([
      "Llama",
    ]);
    expect(screen.getAllByRole("group")).toHaveLength(1);
    await type("claude-son");
    expect(option(/Sonnet/)).not.toBeNull();
    expect(option(/Haiku/)).toBeNull();
    await type("zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText("No model matches.")).not.toBeNull();
  });

  test("a click picks a model, and the default row picks 'the provider's own'", async () => {
    const { changes } = setup();
    await act(async () => {
      fireEvent.click(option(/Haiku/) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(option("Provider default") as HTMLElement);
    });
    expect(changes).toEqual(["claude-haiku-5-5", null]);
  });

  test("the keyboard: arrows move, Home and End jump, Enter picks, Esc clears the filter", async () => {
    const { changes } = setup();
    expect(search().getAttribute("aria-expanded")).toBe("true");
    await key("ArrowDown");
    await key("ArrowDown");
    expect(search().getAttribute("aria-activedescendant")).toBe(option(/Haiku/)?.id ?? "none");
    await key("Enter");
    await key("End");
    await key("Enter");
    await key("Home");
    await key("Enter");
    await key("ArrowUp");
    await key("Enter");
    expect(changes).toEqual(["claude-haiku-5-5", "meta/llama-4", null, "meta/llama-4"]);
    await type("llama");
    await key("Escape");
    expect(search().value).toBe("");
  });

  test("loading and failing are said, and Try again asks for the list once more", async () => {
    const loading = setup({ options: null });
    expect(screen.queryByRole("status")?.textContent).toBe("Loading models…");
    expect(screen.queryByRole("option")).toBeNull();
    cleanup();
    const failed = setup({ options: [], error: "offline" });
    expect(screen.queryByRole("alert")?.textContent).toContain("Could not load the models.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(failed.retries).toEqual([1]);
    expect(loading.retries).toEqual([]);
  });

  test("the effort choice shows only when it is offered and the chosen model takes one", async () => {
    const efforts: string[] = [];
    const effort = {
      label: "Effort",
      levels: ["low", "medium", "high"],
      value: "low",
      onChange: (level: string) => void efforts.push(level),
    };
    const { view, rerender } = setup({ effort });
    expect(screen.queryByLabelText("Effort")).toBeNull();
    rerender(view("claude-sonnet-5-5", { effort }));
    const select = screen.getByLabelText("Effort") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["low", "medium", "high"]);
    await act(async () => {
      fireEvent.change(select, { target: { value: "high" } });
    });
    expect(efforts).toEqual(["high"]);
    rerender(view("claude-haiku-5-5", { effort }));
    expect(screen.queryByLabelText("Effort")).toBeNull();
  });

  test("in Portuguese too", async () => {
    setup({ options: null }, "pt-BR");
    expect(screen.queryByRole("status")?.textContent).toBe("Carregando os modelos…");
    cleanup();
    setup({ options: OPTIONS }, "pt-BR");
    await type("zzz");
    expect(screen.queryByText("Nenhum modelo corresponde.")).not.toBeNull();
    cleanup();
    setup({ options: [], error: "x" }, "pt-BR");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeNull();
  });

  test("it has nothing axe blocks", async () => {
    setup();
    const result = await axe.run(document.body, AXE_RUN_OPTIONS);
    expect(
      blocking(result.violations as Parameters<typeof blocking>[0]).map((v) =>
        describeViolation("model-picker", v),
      ),
    ).toEqual([]);
  });
});
