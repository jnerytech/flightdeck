import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Profiler } from "react";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { hostId, sessionId } from "./scale-fixture.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Four in-process hosts and the app at 200 sessions: more than the default 5 s on a loaded runner.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const HOSTS = 4;
const PER_HOST = 50;

/**
 * Issue #1191: the app connecting to 4 hosts with 50 sessions each. Each host tells the app every
 * session it has as it connects; how often the app renders for that must not grow with the number
 * of sessions (it rendered once per session, and each render walks every list).
 */
async function connect() {
  const urls: string[] = [];
  for (let h = 0; h < HOSTS; h++) {
    const d = makeDaemon(cleanups, {});
    const insert = d.eventStore.db.query(
      `INSERT INTO sessions (id, claude_session_id, cwd, status, permission_mode, created_at, updated_at)
       VALUES (?, NULL, ?, 'idle', 'default', '2026-11-08T10:00:00.000Z', '2026-11-08T10:00:00.000Z')`,
    );
    for (let s = 0; s < PER_HOST; s++) insert.run(sessionId(h, s), `/work/project-${s % 6}`);
    urls.push(d.listen(0).url);
  }
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  const counts = { commits: 0 };
  render(
    <Profiler id="app" onRender={() => counts.commits++}>
      <App store={store} />
    </Profiler>,
  );
  await uiIdle();
  const before = counts.commits;
  for (const [h, url] of urls.entries()) {
    await act(() => store.addHost({ name: hostId(h), url, token: TOKEN }));
  }
  await settle(
    () =>
      store.getState().hosts.length === HOSTS &&
      store.getState().hosts.every((host) => host.sessions.length === PER_HOST),
    20_000,
    "every host lists its 50 sessions",
  );
  await uiIdle();
  return counts.commits - before;
}

describe("scale-connect: the app connects to 4 hosts with 200 sessions (#1191)", () => {
  test("its renders on connect do not grow with the sessions: a few per host, not one per session", async () => {
    const commits = await connect();
    expect({ commits, underBudget: commits <= HOSTS * 12 }).toEqual({
      commits,
      underBudget: true,
    });
  });
});
