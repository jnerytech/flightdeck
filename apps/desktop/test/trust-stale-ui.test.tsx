import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { UntrustedNotice } = await import("../src/components/projects/untrusted-notice.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(language: "en" | "pt-BR", trusted: boolean) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "project.trust.state") {
      return { items: [{ path: "/work/api", trusted, via: trusted ? "/work/api" : null }] };
    }
    return undefined;
  }) as never;
  return { store, sent };
}

const notice = (store: InstanceType<typeof AppStore>, extra: Record<string, unknown> = {}) => (
  <UntrustedNotice store={store} hostId="h1" announced cwd="/work/api" sessionId="s1" {...extra} />
);

describe("trust-stale-ui: a live session says its trust was revoked and offers to restart it (issue #463)", () => {
  test("it says the session still runs with what it loaded, and Restart session closes it and resumes it", async () => {
    const { store, sent } = setup("en", false);
    render(notice(store, { stale: true }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Trust removed. This session still runs with the hooks and MCP servers it loaded. Restart it to apply.",
        ),
      ).not.toBeNull(),
    );
    expect(screen.queryByText(/This folder is not trusted/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restart session" }));
    await waitFor(() =>
      expect(sent.filter(([type]) => type.startsWith("session.")).map(([type]) => type)).toEqual([
        "session.close",
        "session.resume",
      ]),
    );
    expect(sent.filter(([type]) => type.startsWith("session.")).map(([, body]) => body)).toEqual([
      { sessionId: "s1" },
      { sessionId: "s1" },
    ]);
  });

  test("when the restart fails the button is usable again", async () => {
    const { store } = setup("en", false);
    const answer = store.hostCommand;
    store.hostCommand = (async (host: string, type: string, payload: unknown) => {
      if (type === "session.close") throw new Error("host went away");
      return answer.call(store, host, type as never, payload as never);
    }) as never;
    render(notice(store, { stale: true }));
    const button = await screen.findByRole("button", { name: "Restart session" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Restart session" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  test("in Portuguese too", async () => {
    const { store } = setup("pt-BR", false);
    render(notice(store, { stale: true }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Confiança removida. Esta sessão continua com os hooks e servidores MCP que já carregou. Reinicie para aplicar.",
        ),
      ).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Reiniciar sessão" })).not.toBeNull();
  });

  test("a session that is not stale shows the notice it always did", async () => {
    const { store } = setup("en", false);
    render(notice(store));
    await waitFor(() => expect(screen.queryByText(/This folder is not trusted/)).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Restart session" })).toBeNull();
  });

  // #721: like the Review link, the button must not make the notice taller than its text line.
  test("the Restart link sits on the text line: it does not set a button's height of its own", async () => {
    const { store } = setup("en", false);
    render(notice(store, { stale: true }));
    const classes = (
      await screen.findByRole("button", { name: "Restart session" })
    ).className.split(/\s+/);
    expect(classes).toContain("h-auto");
    expect(classes).not.toContain("h-8");
    expect(classes).toContain("py-0");
  });
});
