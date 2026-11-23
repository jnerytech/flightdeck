import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { RoiCard } = await import("../../src/features/roi/roi-card.tsx");
const { EMPTY_PERIOD } = await import("../../src/features/roi/domain/roi.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(open: boolean) {
  const mem = memoryPlatform(false, "en");
  if (open) mem.win.localStorage.setItem("flightdeck.roiOpen", "true");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const answer = {
    hostId: "h1",
    result: {
      projects: [
        { projectKey: "/x/api", current: EMPTY_PERIOD, previous: EMPTY_PERIOD, signals: {} },
      ],
    },
  };
  store.roiFigures.summaries = (async () => [answer]) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <RoiCard
        store={store}
        hostId="h1"
        project={{ id: "p1", name: "api", path: "/x/api", roiSignals: {} } as never}
      />
    </TContext.Provider>,
  );
  return store;
}

const card = () => screen.queryByRole("region", { name: "Return on cost" });
const has = (selector: string) => Boolean(card()?.querySelector(selector));
const details = () => screen.queryByRole("button", { name: "Details" });

describe("roi-fold-ui: the Return on cost card is one line until it is opened (#1031)", () => {
  test("folded, the title, the headline and Details share one row, and nothing else is in the card", async () => {
    setup(false);
    await settleMaybe(() => has("p"));
    const section = card();
    expect(section !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    const title = section?.querySelector("h2");
    const button = details();
    const headline = section?.querySelector("p");
    expect(title !== null && button !== null && headline !== null).toBe(true);
    const row = title?.parentElement;
    expect(row === button?.parentElement).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(row === headline?.parentElement).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(section?.children.length).toBe(1);
  });

  test("the folded headline gives way with an ellipsis instead of making a second line", async () => {
    setup(false);
    await settleMaybe(() => has("p"));
    const headline = card()?.querySelector("p");
    expect(headline?.className.includes("truncate")).toBe(true);
  });

  test("below 640 px the folded headline goes on its own line and wraps, and 1280 px keeps the one row with an ellipsis (#4411)", async () => {
    setup(false);
    await settleMaybe(() => has("p"));
    const headline = card()?.querySelector("p");
    const row = headline?.parentElement;
    const narrow = (headline?.className ?? "").split(" ").filter((c) => c.startsWith("max-sm:"));
    expect({
      rowWraps: row?.classList.contains("max-sm:flex-wrap") ?? false,
      underTitle: narrow.includes("max-sm:basis-full") && narrow.includes("max-sm:order-last"),
      wraps: narrow.includes("max-sm:whitespace-normal"),
      notClipped:
        narrow.includes("max-sm:overflow-visible") && narrow.includes("max-sm:break-words"),
      wideKeepsEllipsis: headline?.classList.contains("truncate") ?? false,
    }).toEqual({
      rowWraps: true,
      underTitle: true,
      wraps: true,
      notClipped: true,
      wideKeepsEllipsis: true,
    });
  });

  test("opened, the card keeps its period buttons and its headline under the title row", async () => {
    setup(false);
    await settleMaybe(() => details() !== null && has("p"));
    const button = details();
    expect(button !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
    await settleMaybe(() => has("fieldset"));
    const section = card();
    expect(has("fieldset")).toBe(true);
    const headline = section?.querySelector("p");
    expect(headline?.parentElement === section).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(details()?.getAttribute("aria-expanded")).toBe("true");
  });

  test("a card the person left open comes back open", async () => {
    setup(true);
    await settleMaybe(() => has("fieldset"));
    expect(has("fieldset")).toBe(true);
  });
});
