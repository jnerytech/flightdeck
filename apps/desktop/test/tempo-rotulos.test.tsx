import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../src/i18n/context.tsx");
const { TimingBreakdown } = await import("../src/ui/TimingBreakdown.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

afterEach(cleanup);

const t = translator("en");

const store = {
  hostCommand: () =>
    Promise.resolve({
      projects: [
        { projectKey: "host:alfa:/a/app", waitMs: 0, slowest: [] },
        { projectKey: "host:alfa:/b/app", waitMs: 0, slowest: [] },
      ],
    }),
} as unknown as AppStore;

async function headings(label?: (key: string) => string): Promise<string[]> {
  render(
    <TContext.Provider value={t}>
      <TimingBreakdown store={store} hostId="h" {...(label ? { label } : {})} />
    </TContext.Provider>,
  );
  await act(() => Bun.sleep(10));
  return screen.queryAllByRole("heading", { level: 4 }).map((h) => h.textContent ?? "");
}

describe("tempo: the heading of each project", () => {
  test("it uses the label the Costs screen gives, so a project reads the same everywhere", async () => {
    const named = (key: string) => (key.endsWith("/a/app") ? "a/app" : "b/app");
    expect(await headings(named)).toEqual(["a/app", "b/app"]);
  });

  test("without one it shows the folder name", async () => {
    expect(await headings()).toEqual(["app", "app"]);
  });
});
