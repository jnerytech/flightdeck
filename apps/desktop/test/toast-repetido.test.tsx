import { afterEach, describe, expect, test } from "bun:test";
import type { Notice } from "../src/lib/app-store.ts";
import { sameNotice } from "../src/lib/notice-lifetime.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, stays } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

const error = (patch: Partial<Notice>): Notice => ({
  id: 1,
  kind: "error",
  code: "terminal_disabled",
  text: "terminal off",
  hostId: "alfa",
  ...patch,
});

describe("toast-repetido: the same error again replaces its toast instead of stacking a second one (issue #581)", () => {
  test("the same error from the same host is the same notice; another host, code, text, reason or params, or a success, is not", () => {
    expect(sameNotice(error({ id: 1 }), error({ id: 2 }))).toBe(true);
    // One code covers several errors (not_found: a card, a session): the words tell them apart.
    expect(
      sameNotice(error({ code: "not_found" }), error({ code: "not_found", text: "other" })),
    ).toBe(false);
    expect(sameNotice(error({ reason: "a" }), error({ reason: "b" }))).toBe(false);
    expect(sameNotice(error({ params: { cwd: "/a" } }), error({ params: { cwd: "/b" } }))).toBe(
      false,
    );
    expect(sameNotice(error({ params: { cwd: "/a" } }), error({ params: { cwd: "/a" } }))).toBe(
      true,
    );
    expect(sameNotice(error({}), error({ hostId: "beta" }))).toBe(false);
    expect(sameNotice(error({}), error({ code: "timeout" }))).toBe(false);
    expect(sameNotice(error({ code: "" }), error({ code: "", text: "terminal off" }))).toBe(true);
    expect(sameNotice(error({ code: "" }), error({ code: "", text: "another problem" }))).toBe(
      false,
    );
    expect(sameNotice(error({}), { ...error({}), kind: "success" })).toBe(false);
  });

  for (const lang of ["en-US", "pt-BR"] as const) {
    test(`${lang}: the same failure twice shows one toast, the newest; another failure shows its own`, async () => {
      const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 60_000 });
      render(<App store={store} />);
      await act(async () => {
        await store.createSession("no-such-host", { cwd: "/", prompt: "hi" });
      });
      await settle(() => screen.queryAllByRole("alert").length === 1);
      const first = store.getState().notices[0]?.id ?? 0;
      await act(async () => {
        await store.createSession("no-such-host", { cwd: "/", prompt: "again" });
      });
      // Exactly one: the old toast leaves (sonner keeps it ~200 ms while it animates out), then none
      // comes back beside the new one.
      await settle(() => screen.queryAllByRole("alert").length === 1);
      const one = await stays(() => screen.queryAllByRole("alert").length === 1).then(
        () => true,
        () => false,
      );
      expect(one).toBe(true);
      expect(store.getState().notices.map((n) => n.id > first)).toEqual([true]);
      await act(async () => {
        store.reportError("Something else broke");
      });
      await settle(() => screen.queryAllByRole("alert").length === 2);
      expect(store.getState().notices).toHaveLength(2);
      store.dispose();
    });
  }
});
