import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(() => cleanup());

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const finish = (sessionId: string, over: Record<string, unknown> = {}) => ({
  key: `h/${sessionId}`,
  hostId: "h",
  sessionId,
  name: sessionId === "s1" ? "Backend tests" : "Docs rewrite",
  outcome: "done",
  at: new Date(NOW - 5 * 60_000).toISOString(),
  files: 3,
  ...over,
});

/** Needs you with nothing waiting, and the finishes `list` after a look at `look`. */
async function open(list: unknown[], look: string | null = null, lang: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { now: () => NOW });
  render(<App store={store} />);
  await act(async () => {
    store.router.push({ name: "needs-you" });
    (store as unknown as { update(patch: object): void }).update({
      hosts: [{ id: "h", name: "alfa", status: "online", sessions: [] }],
      finished: list,
      finishedLook: look,
    });
  });
  return store;
}

const rows = () =>
  [...document.querySelectorAll("section li button")].map((b) => b.textContent ?? "");

describe("needs-you-finished-ui: the Finished group (issue #1134)", () => {
  test("lists what finished, newest first, under its own heading, and the page is not empty", async () => {
    await open([
      finish("s2", { outcome: "failed", files: null, at: new Date(NOW - 60_000).toISOString() }),
      finish("s1"),
    ]);
    expect(screen.getByRole("heading", { name: "Finished", level: 2 })).toBeTruthy();
    const [first, second] = rows();
    expect(first).toContain("Docs rewrite");
    expect(first).toContain("Failed");
    expect(second).toContain("Backend tests");
    expect(second).toContain("Finished");
    expect(document.body.textContent).not.toContain("Nothing is waiting for you.");
  });

  test("a finish seen at the last look is not listed", async () => {
    await open([finish("s1")], new Date(NOW - 60_000).toISOString());
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain("Nothing is waiting for you.");
  });

  test("choosing one shows its outcome, when and how many files, and opens its Changes", async () => {
    const store = await open([finish("s1")]);
    const row = screen.getByRole("button", { name: /Backend tests/ });
    await act(async () => {
      fireEvent.click(row);
    });
    expect(document.body.textContent).toContain("3 files changed");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "See the changes" }));
    });
    expect(store.router.current).toMatchObject({ name: "session", host: "h", id: "s1" });
    expect(store.sessionViews.last("h/s1")).toBe("changes");
  });

  test("a count the host could not give says nothing about files", async () => {
    await open([finish("s1", { files: null })]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Backend tests/ }));
    });
    expect(document.body.textContent).not.toContain("files changed");
    expect(document.body.textContent).not.toContain("No files changed");
  });

  test("leaving the page is the look: they are gone when it comes back", async () => {
    const store = await open([finish("s1")]);
    expect(rows()).toHaveLength(1);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    expect(store.getState().finishedLook).toBe(new Date(NOW).toISOString());
    await act(async () => {
      store.router.push({ name: "needs-you" });
    });
    expect(rows()).toEqual([]);
  });

  test("speaks Portuguese", async () => {
    await open([finish("s1")], null, "pt-BR");
    expect(screen.getByRole("heading", { name: "Concluídas", level: 2 })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Backend tests/ }));
    });
    expect(document.body.textContent).toContain("3 arquivos alterados");
    expect(screen.getByRole("button", { name: "Ver as alterações" })).toBeTruthy();
  });
});
