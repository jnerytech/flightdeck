import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { settleMaybe, uiIdle, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { WorkflowsPage } = await import("../../src/features/workflows/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { memoryPlatform } = await import("../fixtures.ts");

afterEach(cleanup);

const settle = waiter(3000);

const TEXT = {
  en: {
    trust: "Trust feature",
    confirm: "Trust",
    done: "feature trusted",
    refused: "The host did not trust feature. Check the workflow and try again.",
    none: "No commands.",
  },
  "pt-BR": {
    trust: "Confiar em feature",
    confirm: "Confiar",
    done: "feature confiado",
    refused: "O host não confiou em feature. Confira o workflow e tente de novo.",
    none: "Nenhum comando.",
  },
} as const;

type Answer = "accept" | "refuse" | "hold";

/**
 * The page over a host that lists one untrusted workflow. `answer` is what `workflow.trust` comes to:
 * accepted, refused (null), or held until `release()` (a request still in flight).
 */
async function open(language: "en" | "pt-BR", checks: string[], answer: Answer = "accept") {
  const real = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  real.i18n.start();
  const workflow = { name: "feature", hash: "h1", trusted: false, checks, errors: [] };
  const sent: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = { hosts: [{ id: "h1", hostInfo: { daemonVersion: "x" } }] };
  const store = {
    hostCommand: async (_host: string, type: string) => {
      sent.push(type);
      if (type === "workflow.list") return { workflows: [{ ...workflow }] };
      if (answer === "hold") await held;
      if (answer === "refuse") return null;
      workflow.trusted = true;
      return { ...workflow };
    },
    getState: () => state,
    subscribe: () => () => {},
  };
  await act(async () => {
    render(
      <TContext.Provider value={real.i18n.t}>
        <WorkflowsPage store={store as never} hostId="h1" projectId="p1" projectName="app" />
      </TContext.Provider>,
    );
  });
  await settle(() => screen.queryByRole("listitem", { name: /feature/ }) !== null);
  return { sent, release };
}

const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** What the Trust dialog lists, line by line. */
const dialogLines = () => {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  const list = within(dialog as HTMLElement).queryByRole("list");
  return [...(list?.querySelectorAll("li") ?? [])].map((li) => li.textContent ?? "");
};

describe("the Trust dialog lists each command on its own line (#4442)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`${language}: one line per command, in order, and a command with a semicolon stays one line`, async () => {
      await open(language, ["bun lint; bun test", "fd-test --all"]);
      await press(TEXT[language].trust);
      expect(dialogLines()).toEqual(["bun lint; bun test", "fd-test --all"]);
      // The sentence no longer carries the commands.
      const dialog = screen.queryByRole("alertdialog") as HTMLElement;
      expect(
        (dialog.querySelector("[id*=description]")?.textContent ?? "").includes("fd-test"),
      ).toBe(false);
    });

    test(`${language}: a workflow with no command says there are none`, async () => {
      await open(language, []);
      await press(TEXT[language].trust);
      const dialog = screen.queryByRole("alertdialog") as HTMLElement;
      expect(within(dialog).queryByText(TEXT[language].none)).not.toBeNull();
      expect(within(dialog).queryByRole("list")).toBeNull();
    });
  }
});

describe("confirming a Trust says what happened and keeps the focus (#4443)", () => {
  const itemOf = () => screen.queryByRole("listitem", { name: /feature/ }) as HTMLElement;
  const focusInItem = () => itemOf().contains(document.activeElement);

  for (const language of ["en", "pt-BR"] as const) {
    test(`${language}: an accepted trust is said politely with the name, and the focus lands on that workflow`, async () => {
      await open(language, ["fd-test"]);
      await press(TEXT[language].trust);
      await press(TEXT[language].confirm);
      await settleMaybe(() => screen.queryByText(TEXT[language].done) !== null, 1000);
      const status = screen.queryByText(TEXT[language].done);
      expect(status).not.toBeNull();
      expect((status as HTMLElement).closest("[aria-live=polite]")).not.toBeNull();
      expect(screen.queryByRole("button", { name: TEXT[language].trust })).toBeNull();
      expect(focusInItem()).toBe(true);
      expect(document.activeElement?.textContent).toBe("feature");
    });

    test(`${language}: a refused trust is an alert naming the workflow, and Trust is still there with the focus`, async () => {
      await open(language, ["fd-test"], "refuse");
      await press(TEXT[language].trust);
      await press(TEXT[language].confirm);
      await settleMaybe(() => screen.queryByText(TEXT[language].refused) !== null, 1000);
      const alert = screen.queryByText(TEXT[language].refused);
      expect(alert).not.toBeNull();
      expect(alert?.getAttribute("role")).toBe("alert");
      expect(screen.queryByText(TEXT[language].done)).toBeNull();
      const again = screen.queryByRole("button", { name: TEXT[language].trust });
      expect(again).not.toBeNull();
      await settleMaybe(() => document.activeElement === again, 1000);
      expect(document.activeElement === again).toBe(true);
    });
  }

  test("while the request is in flight Trust is off, so a second press opens no dialog", async () => {
    const { sent, release } = await open("en", ["fd-test"], "hold");
    await press(TEXT.en.trust);
    await press(TEXT.en.confirm);
    await uiIdle();
    const button = screen.queryByRole("button", { name: TEXT.en.trust }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("alertdialog") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(sent.filter((type) => type === "workflow.trust")).toHaveLength(1);
    await act(async () => {
      release();
    });
    await settleMaybe(() => screen.queryByText(TEXT.en.done) !== null, 1000);
    expect(screen.queryByText(TEXT.en.done)).not.toBeNull();
  });

  test("cancelling the dialog says nothing and gives the focus back to Trust", async () => {
    await open("en", ["fd-test"]);
    await press(TEXT.en.trust);
    await press("Cancel");
    await uiIdle();
    expect(screen.queryByText(TEXT.en.done)).toBeNull();
    expect(screen.queryByText(TEXT.en.refused)).toBeNull();
    const trust = screen.queryByRole("button", { name: TEXT.en.trust });
    expect(trust).not.toBeNull();
    await settleMaybe(() => document.activeElement === trust, 1000);
    expect(document.activeElement === trust).toBe(true);
  });
});
