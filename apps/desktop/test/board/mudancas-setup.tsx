import { expect } from "bun:test";
import { mkdirSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../../daemon/test/support/board-helpers.ts";
import { poll } from "../../../daemon/test/support/helpers.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const testingLibrary = await import("@testing-library/react");
const { render, within } = testingLibrary;
export const { act, cleanup, fireEvent } = testingLibrary;
export const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const settle = waiter(6000);

export const click = async (name: string | RegExp) => {
  // The session's views are tabs; everything else is a button.
  const button = screen.queryByRole("button", { name }) ?? screen.queryByRole("tab", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

export const text = (name: string) => screen.queryByRole("list", { name })?.textContent ?? "";
export const files = () => text("Arquivos alterados");
export const dialog = () => screen.queryByRole("alertdialog");

/** A host with a git repository inside its allowed root and a session working in it. */
export async function setup(features?: string[], baseDelayMs = 60_000) {
  const watches = { count: 0 };
  const d = makeDaemon(cleanups, {
    review: true,
    changesWatch: (root, onEvent) => {
      const watcher = watch(root, { recursive: true }, (_event, name) =>
        onEvent(name?.toString() ?? null),
      );
      watches.count++;
      return watcher;
    },
  });
  const repo = join(d.root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# repo\nlinha dois\nlinha três\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  const server = d.listen(0, undefined, features);
  const mem = memoryPlatform();
  const clock = { offset: 0 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const store = new AppStore(mem.platform, {
    baseDelayMs,
    now: () => Date.now() + clock.offset,
    timers: {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout: () => {},
    },
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.roster.add({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  return { ...d, ...mem, repo, store, hostId, clock, timers, server, watches };
}

/** Opens the managed session working in `cwd` (its Claude id is known once the first turn ran). */
export async function openSession(ctx: Awaited<ReturnType<typeof setup>>, cwd = ctx.repo) {
  const { sessionId } = await ctx.manager.create({ cwd, prompt: "oi", name: "Revisão" });
  const claudeId = await poll(() => ctx.manager.get(sessionId).claudeSessionId);
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  await act(async () => {
    ctx.store.router.push({ name: "session", host: ctx.hostId, id: sessionId });
  });
  await settle(() => screen.queryByRole("heading", { name: "Revisão" }) !== null);
  return { sessionId, claudeId: claudeId as string };
}

export const openChanges = async () => {
  // The tab comes with the session list, which now waits for the project keys of its folders.
  await settle(() => screen.queryByRole("tab", { name: "Mudanças" }) !== null);
  await click("Mudanças");
  await settle(() => screen.queryByRole("region", { name: "Mudanças" }) !== null);
};
