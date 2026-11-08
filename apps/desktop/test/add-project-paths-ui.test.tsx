import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { AddProject } = await import("../src/components/projects/add-project.tsx");

afterEach(cleanup);

// #1049: a worktree's folder is wider than the dialog. Shown whole, it pushed Cancel and Add out of
// the dialog at 1280, and at 390 the rows were cut at the end, where the folders differ.
const ROOT = "/srv/git";
const LONG = [
  `${ROOT}/web/.flightdeck/worktrees/fd-login-fix`,
  `${ROOT}/web/.flightdeck/worktrees/fd-cart-total`,
];

function setup(language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const sent: unknown[] = [];
  store.hostCommand = (async (_host: string, type: string, payload: { path: string }) => {
    sent.push([type, payload.path]);
    return { id: "p1", name: "p1", path: payload.path };
  }) as never;
  const real = store.getState();
  const sessions = LONG.map((cwd, i) => ({ cwd, updatedAt: `2026-11-0${i + 1}T10:00:00Z` }));
  store.getState = () =>
    ({
      ...real,
      hosts: [{ id: "h1", name: "alfa", sessions, info: { allowedRoots: [ROOT] } }],
      projects: {},
    }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <AddProject store={store} hostId="h1" bare onAdded={() => {}} />
    </TContext.Provider>,
  );
  return { sent };
}

describe("Add project: a long recent folder fits the dialog (#1049)", () => {
  for (const [language, label] of [
    ["en", "Folders of recent sessions"],
    ["pt-BR", "Pastas das sessões recentes"],
  ] as const) {
    test(`${language}: each folder shows cut in the middle, keeps the end that tells it apart, and its whole path as the tooltip`, async () => {
      const { sent } = setup(language);
      const list = screen.queryByRole("region", { name: label });
      expect(list).not.toBeNull();
      const rows = Array.from(list?.querySelectorAll("button") ?? []);
      expect(rows.map((b) => b.textContent)).toEqual([
        "/srv/git/…/worktrees/fd-cart-total",
        "/srv/git/…/worktrees/fd-login-fix",
      ]);
      expect(rows.map((b) => b.getAttribute("title"))).toEqual([LONG[1], LONG[0]]);
      await act(async () => {
        fireEvent.click(rows[0] as HTMLElement);
      });
      expect(sent).toEqual([["project.add", LONG[1]]]);
    });
  }
});
