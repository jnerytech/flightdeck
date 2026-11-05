import { afterEach, describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, renderHook, within } = await import(
  "@testing-library/react"
);
const screen = liveScreen(within);
const { useDraft } = await import("../src/lib/use-draft.ts");
const { CardHours } = await import("../src/components/roi/card-hours.tsx");
const { ClientDefaults } = await import("../src/ui/ClientDefaults.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

// Issue #226: a field seeded once from a prop kept the old value when the prop changed.
describe("stale-seeds: a field follows its source until the person edits it", () => {
  test("useDraft shows the source and keeps an edit over a later source", async () => {
    const { result, rerender } = renderHook(({ source }) => useDraft(source), {
      initialProps: { source: "a" },
    });
    rerender({ source: "b" });
    expect(result.current[0]).toBe("b");
    await act(async () => result.current[1]("typed"));
    rerender({ source: "c" });
    expect(result.current[0]).toBe("typed");
  });

  test("after a save the field keeps what was sent until the source moves, then follows it again", async () => {
    const { result, rerender } = renderHook(({ source }) => useDraft(source), {
      initialProps: { source: "a" },
    });
    await act(async () => result.current[1]("typed"));
    await act(async () => result.current[2]("typed"));
    // The host's update has not arrived: no flash of the old value.
    expect(result.current[0]).toBe("typed");
    rerender({ source: "typed" });
    expect(result.current[0]).toBe("typed");
    rerender({ source: "d" });
    expect(result.current[0]).toBe("d");
  });

  test("a save does not hand back a newer edit typed while it was on its way", async () => {
    const { result, rerender } = renderHook(({ source }) => useDraft(source), {
      initialProps: { source: "a" },
    });
    await act(async () => result.current[1]("first"));
    await act(async () => result.current[1]("second"));
    await act(async () => result.current[2]("first"));
    rerender({ source: "first" });
    expect(result.current[0]).toBe("second");
  });

  test("a card's hours field shows a new estimate made elsewhere", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    const card = { id: "c1", estimateHours: 2 } as Card;
    const view = (c: Card) => (
      <TContext.Provider value={store.i18n.t}>
        <CardHours store={store} hostId="h" card={c} />
      </TContext.Provider>
    );
    const { rerender } = render(view(card));
    rerender(view({ ...card, estimateHours: 3.5 }));
    const field = screen.queryByLabelText(store.i18n.t("roiUi.cardHours")) as HTMLInputElement;
    expect(field?.value).toBe("3.5");
  });

  test("a client's defaults show a tag changed elsewhere", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    const client = {
      id: "acme",
      name: "Acme",
      color: "indigo",
      rules: [],
      defaults: { vaultScope: false, snippetTag: "acme" },
    };
    const view = (c: typeof client) => (
      <TContext.Provider value={store.i18n.t}>
        <ClientDefaults store={store} state={{ hosts: [], secrets: [] }} client={c as never} />
      </TContext.Provider>
    );
    const { rerender } = render(view(client));
    rerender(view({ ...client, defaults: { ...client.defaults, snippetTag: "acme-2" } }));
    const field = screen.queryByLabelText(
      store.i18n.t("clients.snippetTag"),
    ) as HTMLInputElement | null;
    expect(field?.value).toBe("acme-2");
  });
});
