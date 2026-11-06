import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(20_000);
afterEach(cleanup);

interface Setup {
  model?: string;
  lang?: "en" | "pt-BR";
  effort?: boolean;
  noSettings?: boolean;
  runtime?: "claude" | "opencode";
}

/** The open session with the model chip: the model and the effort it was asked to change. */
function view({
  model = "claude-opus-5-5",
  lang = "en",
  effort = true,
  noSettings = false,
  runtime = "claude",
}: Setup = {}) {
  const models: Array<string | null> = [];
  const efforts: Array<string | null> = [];
  render(
    <TContext.Provider value={translator(lang)}>
      <SessionView
        title="refactor"
        t={translator(lang)}
        session={{ ...emptySession(), status: "idle", model }}
        actions={{
          send: async () => {},
          interrupt: async () => {},
          close: async () => {},
          resume: async () => {},
          respond: async () => {},
          setMode: async () => {},
          setModel: async (value) => void models.push(value),
          setEffort: async (level) => void efforts.push(level),
        }}
        settings={!noSettings}
        effort={effort}
        runtime={runtime}
      />
    </TContext.Provider>,
  );
  return { models, efforts };
}

const chip = () => screen.queryByRole("button", { name: /^(Model|Modelo):/ });
/** A Radix menu opens on pointer down. */
const open = async () => {
  const trigger = chip();
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(trigger as HTMLElement);
  });
};
const rows = () => screen.queryAllByRole("menuitemradio");
const row = (name: RegExp | string) => screen.queryByRole("menuitemradio", { name });
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};
/** A submenu of the menu opens on a click of its row. */
const openSub = async (name: RegExp | string) => {
  const trigger = screen.queryByRole("menuitem", { name });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(trigger as HTMLElement);
  });
};

describe("modelo-chip: the chip under the composer", () => {
  test("it names the model the session runs, as family and version, with a tooltip that says what it is", () => {
    view({ model: "claude-opus-5-5" });
    const button = chip();
    expect(button?.getAttribute("aria-label")).toBe("Model: Opus 5.5");
    expect(button?.textContent).toContain("Opus 5.5");
    expect(button?.getAttribute("title")).toBe("The most capable model; the slowest");
  });

  test("a session with no model yet shows the default", () => {
    view({ model: "" });
    expect(chip()?.getAttribute("aria-label")).toBe("Model: Default model");
  });

  test("a session that cannot change its settings shows the model as plain text, no chip", () => {
    view({ noSettings: true });
    expect(chip()).toBeNull();
  });

  test("in Portuguese the chip and its name are in Portuguese", () => {
    view({ lang: "pt-BR", model: "claude-haiku-5-5" });
    expect(chip()?.getAttribute("aria-label")).toBe("Modelo: Haiku 5.5");
  });

  test("an OpenCode session keeps its own list of models, a select", () => {
    view({ runtime: "opencode" });
    expect(chip()).toBeNull();
  });
});

describe("modelo-chip: the Model menu", () => {
  test("it has a title and one numbered row per model, each with its name and what it is for", async () => {
    view({ model: "claude-opus-5-5" });
    await open();
    expect(screen.queryByText("Model")).not.toBeNull();
    expect(rows().map((r) => r.textContent)).toEqual([
      "Default modelThe model Claude Code picks1",
      "OpusThe most capable model; the slowest2",
      "SonnetBalanced: capable and quick3",
      "HaikuThe fastest and lightest4",
    ]);
  });

  test("the model in use is the checked one: an alias, or a version of its family", async () => {
    view({ model: "opus" });
    await open();
    expect(rows().map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
  });

  test("a model the session runs by its exact id is the checked one under More models, and none above", async () => {
    view({ model: "claude-opus-5-5" });
    await open();
    expect(rows().map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "false",
    ]);
    await openSub("More models");
    expect(row(/^Opus 5\.5/)?.getAttribute("aria-checked")).toBe("true");
  });

  test("picking a model changes it at once and the chip follows", async () => {
    const { models } = view({ model: "claude-opus-5-5" });
    await open();
    await click(row(/^Sonnet/));
    expect(models).toEqual(["sonnet"]);
    expect(chip()?.textContent).toContain("Sonnet");
  });

  test("the default row sends null", async () => {
    const { models } = view();
    await open();
    await click(row(/^Default model/));
    expect(models).toEqual([null]);
  });

  test("a number key picks the row with that number", async () => {
    const { models } = view();
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "4" });
    });
    expect(models).toEqual(["haiku"]);
  });

  test("More models lists the versions; one of them is picked by its id and is the checked one", async () => {
    const { models } = view({ model: "claude-opus-5-5" });
    await open();
    await openSub("More models");
    expect(
      rows()
        .map((r) => r.textContent ?? "")
        .filter((text) => /^(Opus 5\.5|Sonnet 5\.5|Haiku 5\.5|Fable 5\.1)/.test(text)),
    ).toHaveLength(4);
    await click(row(/^Fable 5\.1/));
    expect(models).toEqual(["claude-fable-5-1"]);
    expect(chip()?.textContent).toContain("Fable 5.1");
  });
});

describe("modelo-chip: the effort", () => {
  test("the Effort submenu lists the levels with what each does, and Default", async () => {
    view();
    await open();
    await openSub(/^Effort/);
    expect(
      rows()
        .map((r) => r.textContent)
        .filter((text) => /Low|Medium|High|Extra high|Max|Default effort/.test(text ?? "")),
    ).toEqual([
      "Default effortThe model's own level",
      "LowFastest, the least thinking",
      "MediumBalanced",
      "HighMore thinking, slower",
      "Extra highMuch more thinking",
      "MaxThe most thinking; for the hardest problems",
    ]);
  });

  test("picking a level sets it on the live session and the chip shows it after the model", async () => {
    const { efforts } = view({ model: "claude-opus-5-5" });
    await open();
    await openSub(/^Effort/);
    await click(row(/^Medium/));
    expect(efforts).toEqual(["medium"]);
    expect(chip()?.textContent).toContain("Opus 5.5 · Medium");
    expect(chip()?.getAttribute("aria-label")).toBe("Model: Opus 5.5 · Medium");
  });

  test("Default effort sends null and leaves the chip with the model alone", async () => {
    const { efforts } = view();
    await open();
    await openSub(/^Effort/);
    await click(row(/^High/));
    await open();
    await openSub(/^Effort/);
    await click(row(/^Default effort/));
    expect(efforts).toEqual(["high", null]);
    expect(chip()?.getAttribute("aria-label")).toBe("Model: Opus 5.5");
  });

  test("a host that cannot change the effort of a live session has no Effort submenu", async () => {
    view({ effort: false });
    await open();
    expect(screen.queryByRole("menuitem", { name: /^Effort/ })).toBeNull();
  });
});
