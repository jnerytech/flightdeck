import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ExternalView } = await import("../src/ui/ExternalView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

/** Issue #935: a session started in a terminal shows the mode its hooks last reported. */
setDefaultTimeout(20_000);
afterEach(cleanup);

const ID = "eeeeeeee-0000-4000-8000-000000000935";

function view(language: "en" | "pt-BR", mode?: ExternalSession["permissionMode"]) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  const session: ExternalSession = {
    claudeSessionId: ID,
    cwd: "/work/api",
    transcriptPath: null,
    source: "startup",
    status: "idle",
    statusReason: null,
    launchId: null,
    controllable: false,
    projectKey: null,
    startedAt: "2026-11-07T23:00:00.000Z",
    lastEventAt: "2026-11-07T23:00:00.000Z",
    endedAt: null,
    ...(mode ? { permissionMode: mode } : {}),
  };
  const state = { ...store.getState(), externals: { [`h1/${ID}`]: session } };
  render(
    <TContext.Provider value={store.i18n.t}>
      <ExternalView
        store={store}
        state={state}
        hostId="h1"
        hostName="pc"
        claudeSessionId={ID}
        onResumed={() => {}}
      />
    </TContext.Provider>,
  );
}

describe("externa-modo-ui: a terminal session's mode (#935)", () => {
  test("the mode its hooks reported shows on the page, in both languages", () => {
    view("en", "plan");
    const english = screen.queryByText("Permission mode: Plan") !== null;
    cleanup();
    view("pt-BR", "plan");
    expect([english, screen.queryByText("Modo de permissão: Planejar") !== null]).toEqual([
      true,
      true,
    ]);
  });

  test("a session whose hooks said no mode shows none, never a guess", () => {
    view("en");
    expect(screen.queryByText(/^Permission mode:/)).toBeNull();
  });
});
