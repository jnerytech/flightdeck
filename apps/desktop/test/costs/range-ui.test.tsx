import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { CostsFilters } = await import("../../src/features/costs/costs-filters.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

afterEach(cleanup);

const WORDS = {
  en: {
    from: "From",
    to: "To",
    empty: "Pick both dates to change the range.",
    reversed: "From must not be after To.",
  },
  "pt-BR": {
    from: "De",
    to: "Até",
    empty: "Escolha as duas datas para mudar o período.",
    reversed: 'A data "De" não pode vir depois de "Até".',
  },
} as const;

/** The filters on a custom range; `asked` collects every range the screen would load. */
function mount(lang: keyof typeof WORDS) {
  const asked: Array<{ from: string; to: string }> = [];
  render(
    <TContext.Provider value={translator(lang)}>
      <CostsFilters
        store={undefined as never}
        hosts={[]}
        projects={[]}
        scope={undefined as never}
        onPickScope={() => {}}
        period="range"
        onPeriod={() => {}}
        range={{ from: "2026-11-01", to: "2026-11-10" }}
        onRange={(range) => asked.push(range)}
        filters={{}}
        onFilter={() => {}}
        models={[]}
      />
    </TContext.Provider>,
  );
  return asked;
}

const type = async (label: string, value: string) => {
  const input = screen.queryByLabelText(label);
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.change(input as HTMLElement, { target: { value } });
  });
};

describe.each(["en", "pt-BR"] as const)("the dates of a custom range, in %s (#3896)", (lang) => {
  const words = WORDS[lang];

  test("a cleared date is not asked for, and the notice says why", async () => {
    const asked = mount(lang);
    await type(words.from, "");
    expect(asked.some((range) => range.from === "")).toBe(false);
    expect(screen.queryByText(words.empty)).not.toBeNull();
    const input = screen.queryByLabelText(words.from) as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const note = screen.queryByText(words.empty) as HTMLElement;
    expect((input.getAttribute("aria-describedby") ?? "").split(" ").includes(note.id)).toBe(true);
  });

  test("a From after To is not asked for either, and says so", async () => {
    const asked = mount(lang);
    await type(words.from, "2026-11-20");
    expect(asked.length).toBe(0);
    expect(screen.queryByText(words.reversed)).not.toBeNull();
  });

  test("a good pair is asked for and the notice goes", async () => {
    const asked = mount(lang);
    await type(words.from, "");
    await type(words.from, "2026-11-03");
    expect(asked).toEqual([{ from: "2026-11-03", to: "2026-11-10" }]);
    expect(screen.queryByText(words.empty)).toBeNull();
    expect(screen.queryByLabelText(words.from)?.getAttribute("aria-invalid")).toBeNull();
  });
});
