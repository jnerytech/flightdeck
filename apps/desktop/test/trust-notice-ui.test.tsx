import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { UntrustedNotice } = await import("../src/components/projects/untrusted-notice.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(options: {
  trusted: boolean;
  announced?: boolean;
  review?: boolean;
  language?: "en" | "pt-BR";
}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const asked: unknown[] = [];
  store.hostCommand = (async (_host: string, _type: string, payload: unknown) => {
    asked.push(payload);
    return { items: [{ path: "/work/api", trusted: options.trusted, via: null }] };
  }) as never;
  let reviewed = 0;
  const view = (
    <UntrustedNotice
      store={store}
      hostId="h1"
      announced={options.announced ?? true}
      cwd="/work/api"
      {...(options.review === false ? {} : { onReview: () => void reviewed++ })}
    />
  );
  return { view, asked, reviewed: () => reviewed };
}

describe("trust-notice-ui: a session in an untrusted folder says what did not load (#196)", () => {
  test("it says the folder's own configuration and the person's MCP servers did not load, and offers the review", async () => {
    const { view, reviewed } = setup({ trusted: false });
    render(view);
    await waitFor(() =>
      expect(
        screen.queryByText(
          "This folder is not trusted: its own hooks, MCP servers, settings, CLAUDE.md, agents and skills did not load, and neither did your own MCP servers and plugins.",
        ),
      ).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review and trust" }));
    });
    expect(reviewed()).toBe(1);
  });

  test("a trusted folder, a host that does not announce it, and a folder with no project show nothing or no button", async () => {
    const trusted = setup({ trusted: true });
    const first = render(trusted.view);
    await waitFor(() => expect(trusted.asked).toHaveLength(1));
    expect(first.container.textContent).toBe("");
    first.unmount();
    const none = setup({ trusted: false, announced: false });
    const second = render(none.view);
    await act(async () => {});
    expect(none.asked).toHaveLength(0);
    expect(second.container.textContent).toBe("");
    second.unmount();
    const noProject = setup({ trusted: false, review: false });
    render(noProject.view);
    await waitFor(() => expect(screen.queryByText(/This folder is not trusted/)).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Review and trust" })).toBeNull();
  });

  test("in Portuguese too", async () => {
    render(setup({ trusted: false, language: "pt-BR" }).view);
    await waitFor(() => expect(screen.queryByText(/Esta pasta não tem confiança/)).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Revisar e confiar" })).not.toBeNull();
  });
});
