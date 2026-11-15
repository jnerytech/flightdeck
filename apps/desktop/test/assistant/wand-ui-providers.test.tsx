import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { seedHosts } from "../fixtures.ts";
import {
  ANSWER,
  act,
  asked,
  box,
  click,
  fireEvent,
  make,
  restoreGlobals,
  screen,
  type,
  within,
} from "./wand-setup.tsx";

setDefaultTimeout(30_000);
afterEach(restoreGlobals);

/** A field on host `fieldHost` working in /work, an API provider that fails, and a confirmed host "alfa" (h1). */
async function makeScoped(fieldHost: string) {
  const made = await make(
    {
      run: () => {
        throw { reason: "assistant_credits" };
      },
    },
    { field: { hostId: fieldHost, cwd: "/work" } },
  );
  seedHosts(made.store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
  made.store.assistant.confirmHost("h1");
  return { store: made.store, unmount: made.ui.unmount };
}

describe("assistant-wand-ui: providers and hosts (issue #158)", () => {
  test("with no provider the click opens Settings and asks it to say so; nothing is sent", async () => {
    const { store, fake, opened } = await make({}, { configured: false });
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual(["settings"]);
    expect(store.assistant.wantsSetup()).toBe(true);
    expect(asked(fake)).toHaveLength(0);
  });

  test("a host the person never agreed to is not sent the text: the click opens Settings, where it asks once", async () => {
    const { store, fake, opened } = await make({}, { configured: false });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: ANSWER,
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual(["settings"]);
    expect(store.assistant.wantsSetup()).toBe(true);
    expect(toHost).not.toHaveBeenCalled();
    expect(asked(fake)).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a host the person agreed to gets the click without a detour to Settings", async () => {
    const { store, opened } = await make({}, { configured: false });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: ANSWER,
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    expect(opened).toEqual([]);
    expect(store.assistant.wantsSetup()).toBe(false);
    expect(toHost.mock.calls.map((call) => [call[0], call[1]])).toEqual([["h1", "assistant.run"]]);
  });

  test("a secret in the text is refused on the spot, naming what it looks like and never the text", async () => {
    const { fake } = await make();
    type("use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 please");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Nothing was sent");
    expect(alert.textContent).not.toContain("abcdefghijklmnop");
    expect(asked(fake)).toHaveLength(0);
    await click("Dismiss");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a refusal of the provider is said in words", async () => {
    await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The provider says there is no credit left on this key.");
  });

  test("a failure offers each other provider that could run, by name, and a click sends the same text there", async () => {
    let failing = true;
    const { store, fake } = await make({
      run: () => {
        if (failing) throw { reason: "assistant_credits" };
        return { ...ANSWER, text: "Fix the total." };
      },
    });
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: { ...ANSWER, text: "Fix the total, from alfa." },
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: "Try with alfa" })).not.toBeNull();
    expect(
      within(alert).queryByRole("button", { name: "Try with OpenRouter (API key)" }),
    ).not.toBeNull();
    expect(within(alert).queryByRole("button", { name: /Try with Anthropic/ })).toBeNull();
    failing = false;
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try with OpenRouter (API key)" }));
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    const last = asked(fake).at(-1);
    expect(last?.[3]).toMatchObject({ provider: "openrouter" });
    expect(JSON.stringify(last?.[1])).toContain("fix the totl");
    expect(toHost).not.toHaveBeenCalled();
    expect(box().value).toBe("fix the totl");
  });

  test("Try with a host sends the same text to that host, and nowhere else", async () => {
    const { store, fake } = await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    store.assistant.confirmHost("h1");
    const toHost = spyOn(store, "hostRequest").mockResolvedValue({
      ok: true,
      data: { ...ANSWER, text: "Fix the total, from alfa." },
    } as never);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    const tryAlfa = within(alert).queryByRole("button", { name: "Try with alfa" });
    expect(tryAlfa).not.toBeNull();
    await act(async () => {
      fireEvent.click(tryAlfa as HTMLElement);
    });
    const dialog = await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(dialog.textContent).toContain("Fix the total, from alfa.");
    expect(toHost.mock.calls.map((call) => [call[0], call[1]])).toEqual([["h1", "assistant.run"]]);
    expect(asked(fake)).toHaveLength(1);
  });

  test("Try with sends the text the failed run had, not what the box holds by now", async () => {
    let first = true;
    const { store, fake } = await make({
      run: () => {
        if (first) {
          first = false;
          throw { reason: "assistant_credits" };
        }
        return { ...ANSWER, text: "Fixed." };
      },
    });
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    type("a different text");
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Try with OpenRouter (API key)" }));
    });
    await screen.findByRole("dialog", { name: "AI suggestion" });
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).toContain("fix the totl");
    expect(JSON.stringify(asked(fake).at(-1)?.[1])).not.toContain("a different text");
  });

  test("the folder of the field goes only to the host of the field, never to another host", async () => {
    for (const [fieldHost, cwd] of [
      ["h0", undefined],
      ["h1", "/work"],
    ] as const) {
      const { store, unmount } = await makeScoped(fieldHost);
      const toHost = spyOn(store, "hostRequest").mockResolvedValue({
        ok: true,
        data: { ...ANSWER, text: "Fixed." },
      } as never);
      type("fix the totl");
      await click("Improve with AI");
      const alert = await screen.findByRole("alert");
      await act(async () => {
        fireEvent.click(within(alert).getByRole("button", { name: "Try with alfa" }));
      });
      await screen.findByRole("dialog", { name: "AI suggestion" });
      const payload = toHost.mock.calls[0]?.[2] as { cwd?: string };
      expect(payload.cwd).toBe(cwd);
      unmount();
    }
  });

  test("a host the person never agreed to, or no other provider at all, offers no Try with", async () => {
    const { store } = await make({
      run: () => {
        throw { reason: "assistant_credits" };
      },
    });
    seedHosts(store, [{ id: "h1", name: "alfa", features: ["assistant"] }]);
    type("fix the totl");
    await click("Improve with AI");
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: /Try with/ })).toBeNull();
    expect(within(alert).queryByRole("button", { name: "Dismiss" })).not.toBeNull();
  });

  test("Try with reads in Portuguese", async () => {
    const { store, fake } = await make(
      {
        run: () => {
          throw { reason: "assistant_credits" };
        },
      },
      { language: "pt-BR" },
    );
    await fake.assistant.setKey("openrouter", "sk-or-ccccdddd");
    await store.assistant.refreshKeys();
    type("corrige o totl");
    await click("Melhorar com IA");
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).queryByRole("button", { name: "Tentar com OpenRouter (chave de API)" }),
    ).not.toBeNull();
  });
});
