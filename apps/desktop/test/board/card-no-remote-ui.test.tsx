import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { CardRunForm } = await import("../../src/features/board/card-run-form.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const finished = {
  id: "c1",
  projectId: "p1",
  title: "Cart screen",
  description: "",
  column: "review",
  validationNote: null,
  prUrl: null,
  prState: null,
  queued: false,
  sessionId: "s1",
  sessionStatus: "ended",
  worktreePath: "/w",
  branch: "card/cart-screen",
};

function setup(
  provider: string | null,
  language: "en" | "pt-BR" = "en",
  refusePr = false,
  /** A host that answers only when the test lets it. */
  gate?: Promise<void>,
) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (provider !== null)
    (store as unknown as { update(p: object): void }).update({
      projects: { h1: [{ id: "p1", name: "shop", prProvider: provider }] },
    });
  const commands: string[] = [];
  store.hostCommand = (async (_host: string, type: string) => {
    commands.push(type);
    return {};
  }) as never;
  store.hostRequest = (async (_host: string, type: string) => {
    commands.push(type);
    if (gate && type === "card.pr.create") await gate;
    return refusePr && type === "card.pr.create"
      ? {
          ok: false,
          code: "refused",
          message: "the project has no PR provider",
          reason: "project_no_pr_provider",
          params: {},
        }
      : { ok: true, data: {} };
  }) as never;
  store.prWatch.describe = (async () => {
    commands.push("describePr");
    return { text: "text", redacted: 0 };
  }) as never;
  const seen = { shown: 0 };
  const form = (tab: "conversation" | "diff") => (
    <TContext.Provider value={store.i18n.t}>
      <CardRunForm
        store={store}
        hostId="h1"
        card={finished as never}
        features={{ bg: true, watch: true }}
        tab={tab}
        canMerge={false}
        gateWaiting={false}
        onMerge={() => {}}
        arenaStart={null}
        onDiscarded={() => {}}
        onShowDiff={() => {
          seen.shown++;
        }}
      />
    </TContext.Provider>
  );
  return { store, commands, seen, form };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
async function openMenu() {
  const trigger = button("Actions for Cart screen") ?? button("Ações de Cart screen");
  expect(trigger !== null).toBe(true);
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
const panel = () => document.querySelector('[data-slot="card-run"]')?.textContent ?? "";

describe("card-no-remote-ui: Open PR on a project that has no PR provider (#1543)", () => {
  test("on the changes, there is no Open PR button: the panel says why and where the work is, before any form", async () => {
    const w = setup("none");
    render(w.form("diff"));
    expect(button("Open PR") === null).toBe(true);
    expect(panel()).toContain("no PR provider set");
    expect(panel()).toContain("git remote add origin");
    expect(panel()).toContain("gh auth login");
    expect(panel()).toContain("az login");
    expect(panel()).toContain("card/cart-screen");
    // The changes stay the card's lead on its own tab: nothing unmounts under the person's focus.
    expect(button("Review changes") !== null).toBe(true);
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "Open PR" }) === null).toBe(true);
    // Nothing was asked of the host: no description, no form.
    expect(w.commands).toEqual([]);
  });

  test("pressing Review changes keeps the focus on that same button when the changes open", async () => {
    const w = setup("none");
    const view = render(w.form("conversation"));
    const review = button("Review changes");
    expect(review !== null).toBe(true);
    (review as HTMLElement).focus();
    await act(async () => {
      fireEvent.click(review as HTMLElement);
    });
    view.rerender(w.form("diff"));
    const after = button("Review changes");
    expect(after === review).toBe(true);
    expect(document.activeElement === review).toBe(true);
  });

  test("the card's changes stay reachable: Review changes leads from the conversation", async () => {
    const w = setup("none");
    render(w.form("conversation"));
    expect(button("Review changes") !== null).toBe(true);
    expect(button("Open PR") === null).toBe(true);
    expect(panel()).toContain("no PR provider set");
    await act(async () => {
      fireEvent.click(button("Review changes") as HTMLElement);
    });
    expect(w.seen.shown).toBe(1);
  });

  test("the same in Portuguese", () => {
    const w = setup("none", "pt-BR");
    render(w.form("diff"));
    expect(button("Abrir PR") === null).toBe(true);
    expect(panel()).toContain("sem provedor de PR");
    expect(panel()).toContain("card/cart-screen");
  });

  test("a project with a provider keeps Open PR, and says nothing about a remote", async () => {
    const w = setup("github");
    render(w.form("diff"));
    expect(button("Open PR") !== null).toBe(true);
    expect(panel()).not.toContain("remote");
    await act(async () => {
      fireEvent.click(button("Open PR") as HTMLElement);
    });
    expect(w.commands).toContain("describePr");
  });

  test("a project the app has not loaded yet is not judged: Open PR stays, and the host still decides", () => {
    const w = setup(null);
    render(w.form("diff"));
    expect(button("Open PR") !== null).toBe(true);
    expect(panel()).not.toContain("remote");
  });
});

describe("card-no-remote-ui: a refused Open PR keeps what the person wrote (#1543)", () => {
  const dialogText = () =>
    (screen.queryByRole("textbox", { name: "PR description" }) as HTMLTextAreaElement | null)
      ?.value ?? null;

  async function writeAndConfirm(w: ReturnType<typeof setup>) {
    render(w.form("diff"));
    await act(async () => {
      fireEvent.click(button("Open PR") as HTMLElement);
    });
    const box = screen.queryByRole("textbox", { name: "PR description" });
    expect(box !== null).toBe(true);
    await act(async () => {
      fireEvent.change(box as HTMLElement, { target: { value: "what I wrote for the PR" } });
    });
    await act(async () => {
      fireEvent.click(button(/Open the PR/) as HTMLElement);
    });
  }

  test("the host refuses (a project the app did not know had no provider): the dialog stays, with the text", async () => {
    const w = setup(null, "en", true);
    await writeAndConfirm(w);
    expect(w.commands).toContain("card.pr.create");
    expect(dialogText()).toBe("what I wrote for the PR");
    // The reason is in the dialog, where the person is, not in a toast behind it.
    const reason = screen.queryByRole("alert");
    expect(reason?.textContent ?? "").toContain("The project has no PR provider.");
    expect(reason?.textContent ?? "").toContain("Set it in the project's settings");
    expect(reason !== null && reason.closest('[role="dialog"]') !== null).toBe(true);
  });

  test("the host accepts: the dialog closes", async () => {
    const w = setup(null, "en", false);
    await writeAndConfirm(w);
    expect(w.commands).toContain("card.pr.create");
    expect(dialogText()).toBeNull();
  });
});

describe("card-no-remote-ui: a late refusal does not outlive its dialog (#1543)", () => {
  test("cancelled while the host was still answering, the refusal is not shown on the next Open PR", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = setup(null, "en", true, gate);
    render(w.form("diff"));
    const open = async () => {
      await act(async () => {
        fireEvent.click(button("Open PR") as HTMLElement);
      });
    };
    await open();
    await act(async () => {
      fireEvent.click(button(/Open the PR/) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(button("Cancel") as HTMLElement);
    });
    await act(async () => {
      release();
    });
    await open();
    expect(screen.queryByRole("textbox", { name: "PR description" }) !== null).toBe(true);
    expect(screen.queryByRole("alert") === null).toBe(true);
  });
});
