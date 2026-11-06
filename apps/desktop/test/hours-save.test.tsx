import { afterEach, describe, expect, test } from "bun:test";
import type { Card } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { CardHours } = await import("../src/components/roi/card-hours.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

describe("hours-save: the card's hours Save is on only for a number it can save", () => {
  // OpenCode branch review m3 (#174): a text that was not a number did nothing on Save, silently.
  test("Save is off while unchanged, off with a reason for a text that is not 0 to 1000 hours, on for a valid change", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    const t = store.i18n.t;
    render(
      <TContext.Provider value={t}>
        <CardHours store={store} hostId="h" card={{ id: "c1", estimateHours: 2 } as Card} />
      </TContext.Provider>,
    );
    const field = screen.queryByLabelText(t("roiUi.cardHours")) as HTMLInputElement;
    const save = () =>
      screen.queryByRole("button", { name: t("roiUi.cardHoursSave") }) as HTMLButtonElement;
    const type = (value: string) =>
      act(async () => {
        fireEvent.change(field, { target: { value } });
      });
    expect(save().disabled).toBe(true);
    for (const bad of ["abc", "-1", "1001"]) {
      await type(bad);
      expect([bad, save().disabled]).toEqual([bad, true]);
      expect(document.body.textContent ?? "").toContain(t("roiUi.cardHoursInvalid"));
    }
    await type("3.5");
    expect(save().disabled).toBe(false);
    await type("");
    expect(save().disabled).toBe(false);
  });
});
