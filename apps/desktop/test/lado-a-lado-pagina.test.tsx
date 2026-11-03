import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore, sessionKey } = await import("../src/lib/app-store.ts");
const { hubRows } = await import("../src/lib/hub.ts");
const { useStoreState } = await import("../src/lib/use-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function Page(props: {
  store: InstanceType<typeof AppStore>;
  hostId: string;
  projectKey: string;
  path: string;
  go(route: Route): void;
}) {
  const live = useStoreState(props.store);
  const state = {
    ...live,
    projects: {
      [props.hostId]: [
        {
          id: "p1",
          name: "api",
          path: props.path,
          baseBranch: "main",
          projectKey: props.projectKey,
        },
      ],
    },
  } as never as typeof live;
  return (
    <ProjectPage
      store={props.store}
      state={state}
      hostId={props.hostId}
      projectId="p1"
      go={props.go}
    />
  );
}

describe("lado-a-lado-pagina: tiles on the project page", () => {
  test("the project page shows its sessions side by side, and a tile opens its session", async () => {
    const d = makeDaemon(cleanups);
    const server = d.listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    store.i18n.start();
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
    const id = (await store.createSession(hostId, {
      cwd: d.project,
      prompt: "oi",
      name: "primeira",
    })) as string;
    await waitFor(() => store.getState().sessions[sessionKey(hostId, id)]?.status === "idle");
    store.select(hostId, null);
    await store.refreshHub();
    const projectKey = hubRows(store.getState())[0]?.projectKey as string;
    const went: Route[] = [];
    render(
      <Page
        store={store}
        hostId={hostId}
        projectKey={projectKey}
        path={d.project}
        go={(route) => void went.push(route)}
      />,
    );
    await waitFor(
      () => document.querySelector("[data-slot='session-tile']") !== null,
      "a tile on the page",
    );
    expect(screen.getByRole("heading", { name: "Sessions side by side" })).toBeTruthy();
    // The destinations are still there.
    expect(screen.getByRole("button", { name: "Board" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open primeira" }));
    });
    expect(went).toEqual([{ name: "session", host: hostId, id }]);
  });
});
