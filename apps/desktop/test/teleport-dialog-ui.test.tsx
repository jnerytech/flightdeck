import { afterEach, describe, expect, test } from "bun:test";
import type { TeleportOutcome, TeleportSummary } from "../src/lib/teleport.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeleportDialog } = await import("../src/ui/TeleportDialog.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { RequestError } = await import("../src/lib/host-connection.ts");

/**
 * Issue #100, slice 3b: the dialog that moves a session to another host. The person picks the host
 * and the repository, sees counts and sizes (never a secret), says yes, watches it go and opens it
 * on the other host; a refusal reads as the app's own text, never the host's message.
 */
afterEach(() => cleanup());
const settle = waiter(4000);

const SUMMARY: TeleportSummary = {
  branch: "feature/login",
  ahead: 3,
  changed: 2,
  bytes: 2048,
  secretLines: 1,
};

const TEXT = {
  en: {
    host: "Host",
    repo: "Repository on that host",
    next: "Continue",
    move: "Move",
    back: "Back",
    open: "Open it there",
    secrets: "Lines that look like secrets: 1",
    moving: "Moving… 50%",
    done: "The session is on pi now.",
    refused: "This repository is not the session's project",
  },
  "pt-BR": {
    host: "Host",
    repo: "Repositório nesse host",
    next: "Continuar",
    move: "Mover",
    back: "Voltar",
    open: "Abrir lá",
    secrets: "Linhas que parecem segredos: 1",
    moving: "Movendo… 50%",
    done: "A sessão está agora em pi.",
    refused: "Este repositório não é o projeto da sessão",
  },
} as const;

/** The dialog with a fake run the test drives: the person's answers and the move's end. */
function open(lang: "en" | "pt-BR", summary: TeleportSummary = SUMMARY) {
  const calls = {
    opened: [] as string[][],
    closed: 0,
    args: [] as Array<{ target: string; repo: string }>,
  };
  const control: {
    confirm?: (summary: TeleportSummary) => Promise<boolean>;
    progress?: (sent: number, total: number) => void;
    finish?: (outcome: TeleportOutcome) => void;
    fail?: (error: unknown) => void;
    answer?: Promise<boolean>;
    signal?: AbortSignal;
  } = {};
  render(
    <TContext.Provider value={translator(lang)}>
      <TeleportDialog
        targets={[{ id: "h2", name: "pi" }]}
        repoField={(_hostId, value, onChange) => (
          <input aria-label="repo-path" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        run={(args) => {
          calls.args.push({ target: args.target, repo: args.repo });
          control.progress = args.onProgress;
          control.signal = args.signal;
          control.answer = args.confirm(summary);
          return new Promise<TeleportOutcome>((resolve, reject) => {
            control.finish = resolve;
            control.fail = reject;
          });
        }}
        onOpen={(host, session) => calls.opened.push([host, session])}
        onClose={() => {
          calls.closed++;
        }}
      />
    </TContext.Provider>,
  );
  return { calls, control };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** Picks the host (the repository field is for that host), types the repository, continues. */
async function start(lang: "en" | "pt-BR") {
  const t = TEXT[lang];
  const host = screen.queryByRole("combobox", { name: t.host });
  expect(host).not.toBeNull();
  await act(async () => {
    fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
  });
  const repo = screen.queryByRole("textbox", { name: "repo-path" });
  expect(repo).not.toBeNull();
  await act(async () => {
    fireEvent.change(repo as HTMLElement, { target: { value: "/work/app" } });
  });
  await click(t.next);
}

const shows = (text: string) =>
  settle(() => (document.body.textContent ?? "").includes(text)).then(
    () => true,
    () => false,
  );

describe("teleport-dialog-ui: the person moves a session to another host (#100)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const t = TEXT[lang];

    test(`${lang}: the summary shows counts, a yes moves it with progress, and the session opens there`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      const summary = await shows(t.secrets);
      const branch = document.querySelector("bdi")?.textContent ?? null;
      await click(t.move);
      const answer = await control.answer;
      await act(async () => {
        control.progress?.(1024, 2048);
      });
      const moving = await shows(t.moving);
      await act(async () => {
        control.finish?.({ kind: "moved", sessionId: "t1", worktree: "/w", branch: "fd/x" });
      });
      const done = await shows(t.done);
      await click(t.open);
      expect([calls.args, summary, branch, answer, moving, done, calls.opened]).toEqual([
        [{ target: "h2", repo: "/work/app" }],
        true,
        "feature/login",
        true,
        true,
        true,
        [["h2", "t1"]],
      ]);
    });

    test(`${lang}: going back says no to the move, and the dialog closes`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(t.secrets);
      await click(t.back);
      const answer = await control.answer;
      await act(async () => {
        control.finish?.({ kind: "declined" });
      });
      expect([
        answer,
        await settle(() => calls.closed === 1).then(
          () => true,
          () => false,
        ),
      ]).toEqual([false, true]);
    });

    test(`${lang}: a refusal reads as the app's text, never the host's message`, async () => {
      const { control } = open(lang);
      await start(lang);
      await shows(t.secrets);
      await click(t.move);
      await act(async () => {
        control.fail?.(
          new RequestError("invalid_state", "host says ghp_secret", "teleport_no_project"),
        );
      });
      expect([
        await shows(t.refused),
        (document.body.textContent ?? "").includes("ghp_secret"),
      ]).toEqual([true, false]);
    });
  }

  test("Cancel during the move stops it, Escape on the summary says no, and Escape before it closes", async () => {
    const pressEscape = async () => {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
    };
    const first = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      first.control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    await click("Cancel");
    const stopped = first.control.signal?.aborted ?? false;
    await pressEscape();
    const stoppedByEscape = first.control.signal?.aborted ?? false;
    cleanup();
    const second = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    let answered: boolean | null = null;
    void second.control.answer?.then((yes) => {
      answered = yes;
    });
    await pressEscape();
    // The answer the run got, if any: a dialog that just closed never answers.
    const declined = await settle(() => answered !== null).then(
      () => answered,
      () => "no answer",
    );
    cleanup();
    const third = open("en");
    await pressEscape();
    expect([stopped, stoppedByEscape, declined, third.calls.closed]).toEqual([
      true,
      true,
      false,
      1,
    ]);
  });

  test("a session on no branch says so instead of a branch name", async () => {
    open("en", { ...SUMMARY, branch: null });
    await start("en");
    expect([await shows("none (a detached HEAD)"), document.querySelector("bdi") === null]).toEqual(
      [true, true],
    );
  });

  test("progress past the total or with nothing to send stays between 0% and 100%", async () => {
    const { control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(5000, 2048);
    });
    const over = await shows("Moving… 100%");
    await act(async () => {
      control.progress?.(0, 0);
    });
    expect([over, await shows("Moving… 0%")]).toEqual([true, true]);
  });
});
