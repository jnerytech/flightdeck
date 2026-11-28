import { afterEach, describe, expect, test } from "bun:test";
import type { TeleportOutcome, TeleportSummary } from "../../src/features/teleport/teleport.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { settleMaybe, waiter } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TeleportDialog } = await import("../../src/features/teleport/teleport-dialog.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

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

/**
 * The dialog with a fake run the test drives: the person's answers and the move's end. `held` keeps
 * the source preparing until the test calls `ready`.
 */
function open(
  lang: "en" | "pt-BR",
  summary: TeleportSummary = SUMMARY,
  held = false,
  targets: ReadonlyArray<{ id: string; name: string }> = [{ id: "h2", name: "pi" }],
  plain?: (target: string) => string[],
) {
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
    ready?: () => void;
  } = {};
  render(
    <TContext.Provider value={translator(lang)}>
      <TeleportDialog
        targets={targets}
        {...(plain ? { plain } : {})}
        repoField={(_hostId, value, onChange) => (
          <input aria-label="repo-path" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        run={(args) => {
          calls.args.push({ target: args.target, repo: args.repo });
          control.progress = args.onProgress;
          control.signal = args.signal;
          control.ready = () => {
            control.answer = args.confirm(summary);
          };
          if (!held) control.ready();
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

    test(`${lang}: Open it there opens the session and closes the dialog, once (#842)`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(t.secrets);
      await click(t.move);
      await control.answer;
      await act(async () => {
        control.finish?.({ kind: "moved", sessionId: "t1", worktree: "/w", branch: "fd/x" });
      });
      await shows(t.done);
      await click(t.open);
      expect([calls.opened, calls.closed]).toEqual([[["h2", "t1"]], 1]);
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

  for (const [lang, retry, closeLabel] of [
    ["en", "Try again", "Close"],
    ["pt-BR", "Tentar de novo", "Fechar"],
  ] as const) {
    test(`${lang}: a failed move offers ${retry}, which keeps the host and the repository and lets a second move start (#4123)`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.fail?.(new RequestError("invalid_state", "host says no", "teleport_no_project"));
      });
      await shows(TEXT[lang].refused);
      await click(retry);
      const host = screen.queryByRole("combobox", {
        name: TEXT[lang].host,
      }) as HTMLSelectElement | null;
      const repo = screen.queryByRole("textbox", { name: "repo-path" }) as HTMLInputElement | null;
      const kept = [host?.value ?? null, repo?.value ?? null];
      await click(TEXT[lang].next);
      const second = calls.args.length;
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.fail?.(new RequestError("invalid_state", "x", "teleport_no_project"));
      });
      // A second failure offers the way back again.
      const again = await settle(() => screen.queryByRole("button", { name: retry }) !== null).then(
        () => true,
        () => false,
      );
      expect([kept, second, again, calls.closed]).toEqual([["h2", "/work/app"], 2, true, 0]);
    });

    test(`${lang}: Close on a failed move still closes the dialog once (#4123)`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.fail?.(new TypeError("not a refusal"));
      });
      await settle(() => screen.queryByRole("alert") !== null);
      // The dialog's own X has the same name: Close is the form's own button.
      const form = screen.queryByRole("alert")?.closest("form") ?? null;
      expect(form).not.toBeNull();
      const close = within(form as HTMLFormElement).queryByRole("button", { name: closeLabel });
      expect(close).not.toBeNull();
      await act(async () => {
        fireEvent.click(close as HTMLElement);
      });
      expect(calls.closed).toBe(1);
    });
  }

  test("Try again with a host that is no longer offered asks for a host again instead of moving to it (#4123)", async () => {
    const targets = [{ id: "h2", name: "pi" }];
    const { calls, control } = open("en", SUMMARY, false, targets);
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.fail?.(new RequestError("invalid_state", "x", "teleport_no_project"));
    });
    await shows(TEXT.en.refused);
    // The host went offline while the move ran: the list has another one now.
    targets.splice(0, targets.length, { id: "h3", name: "nas" });
    await click("Try again");
    const next = screen.queryByRole("button", { name: TEXT.en.next });
    // The first step is back with no host picked: no repository field, nothing moves.
    expect([
      next === null,
      screen.queryByRole("textbox", { name: "repo-path" }) === null,
      calls.args.length,
    ]).toEqual([false, true, 1]);
  });

  test("a move that landed but names no session offers Close only: Try again would move it twice (#4123)", async () => {
    const { control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.finish?.({ kind: "moved", sessionId: "", worktree: "/w", branch: "fd/x" });
    });
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: the moving step shows a progress bar with the percent beside the text, and a full one while the host finishes (#4127)`, async () => {
      const { control } = open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.progress?.(820, 2048);
      });
      await shows(lang === "en" ? "Moving… 40%" : "Movendo… 40%");
      const bar = () => screen.queryByRole("progressbar");
      const reading = (el: HTMLElement | null) => [
        el?.getAttribute("aria-valuenow") ?? null,
        el?.getAttribute("aria-valuemin") ?? null,
        el?.getAttribute("aria-valuemax") ?? null,
      ];
      const during = reading(bar());
      await act(async () => {
        control.progress?.(2048, 2048);
      });
      await shows(lang === "en" ? "Finishing on pi…" : "Finalizando em pi…");
      expect([during, reading(bar())]).toEqual([
        ["40", "0", "100"],
        ["100", "0", "100"],
      ]);
    });

    test(`${lang}: the no-host message names no feature: the word teleport is not in it (#4126)`, async () => {
      open(lang, SUMMARY, false, []);
      await shows(REASONS[lang].none);
      expect((document.body.textContent ?? "").toLowerCase().includes("teleport")).toBe(false);
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
    cleanup();
    const moving = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      moving.control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    await pressEscape();
    const stoppedByEscape = moving.control.signal?.aborted ?? false;
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

  test("an error that is not a host's refusal, or a move that names no session, shows the app's alert instead of hanging", async () => {
    const first = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      first.control.fail?.(new TypeError("not a refusal"));
    });
    const failed = await settle(() => screen.queryByRole("alert") !== null).then(
      () => true,
      () => false,
    );
    cleanup();
    const second = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      second.control.finish?.({ kind: "moved", sessionId: "", worktree: "/w", branch: "fd/x" });
    });
    const nameless = await settle(() => screen.queryByRole("alert") !== null).then(
      () => true,
      () => false,
    );
    expect([failed, (document.body.textContent ?? "").includes("not a refusal"), nameless]).toEqual(
      [true, false, true],
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

  test("a second Continue while the host prepares starts no second move, and Cancel then frees the package and closes once", async () => {
    const { calls, control } = open("en", SUMMARY, true);
    await start("en");
    const preparing = await shows("Getting the session ready…");
    // A double-click or a second Enter: the form on screen is sent again.
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    const runs = calls.args.length;
    await click("Cancel");
    let answered: boolean | null = null;
    await act(async () => {
      control.ready?.();
    });
    void control.answer?.then((yes) => {
      answered = yes;
    });
    await settleMaybe(() => answered !== null, 2000);
    // The run ends as declined after the dialog already closed: it does not close it again.
    await act(async () => {
      control.finish?.({ kind: "declined" });
    });
    expect([preparing, runs, answered, calls.closed]).toEqual([true, 1, false, 1]);
  });

  test("Enter or a second click on Move never cancels the move it just started", async () => {
    const { control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(10, 100);
    });
    await shows("Moving… 10%");
    const form = screen.queryByRole("status")?.closest("form") ?? null;
    expect(form).not.toBeNull();
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });
    const move = screen.queryByRole("button", { name: TEXT.en.move });
    expect(move).not.toBeNull();
    await act(async () => {
      fireEvent.click(move as HTMLElement);
    });
    expect([
      control.signal?.aborted ?? null,
      screen.queryByRole("button", { name: "Cancel" }) !== null,
    ]).toEqual([false, true]);
  });

  for (const [lang, finishingText, closeLabel] of [
    ["en", "Finishing on pi…", "Close"],
    ["pt-BR", "Finalizando em pi…", "Fechar"],
  ] as const) {
    test(`${lang}: once every byte is sent the move cannot be cancelled, but the dialog can close while the host finishes`, async () => {
      const { calls, control } = open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      await click(TEXT[lang].move);
      await act(async () => {
        control.progress?.(2048, 2048);
      });
      const finishing = await shows(finishingText);
      const cancel =
        screen.queryByRole("button", { name: lang === "en" ? "Cancel" : "Cancelar" }) !== null;
      // A host that never answers the import: the person is never stuck in the dialog. The form's
      // own Close, not the dialog's X.
      const form = screen.queryByRole("status")?.closest("form") ?? null;
      const close = form ? within(form).queryByRole("button", { name: closeLabel }) : null;
      expect(close).not.toBeNull();
      await act(async () => {
        fireEvent.click(close as HTMLElement);
      });
      expect([finishing, cancel, calls.closed, control.signal?.aborted ?? null]).toEqual([
        true,
        false,
        1,
        false,
      ]);
    });
  }

  test("Escape while the host finishes closes the dialog, and the move goes on", async () => {
    const { calls, control } = open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    await click(TEXT.en.move);
    await act(async () => {
      control.progress?.(2048, 2048);
    });
    await shows("Finishing on pi…");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect([calls.closed, control.signal?.aborted ?? null]).toEqual([1, false]);
  });

  test("pt-BR: the dialog says it is getting the session ready while the host prepares", async () => {
    open("pt-BR", SUMMARY, true);
    await start("pt-BR");
    expect(await shows("Preparando a sessão…")).toBe(true);
  });

  test("a repository of spaces does not continue, and the one typed goes without its spaces", async () => {
    const { calls } = open("en");
    const host = screen.queryByRole("combobox", { name: TEXT.en.host });
    await act(async () => {
      fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
    });
    const repo = screen.queryByRole("textbox", { name: "repo-path" });
    await act(async () => {
      fireEvent.change(repo as HTMLElement, { target: { value: "   " } });
    });
    const blank =
      (screen.queryByRole("button", { name: TEXT.en.next }) as HTMLButtonElement | null)
        ?.disabled ?? null;
    await act(async () => {
      fireEvent.change(repo as HTMLElement, { target: { value: "  /work/app  " } });
    });
    await click(TEXT.en.next);
    expect([blank, calls.args]).toEqual([true, [{ target: "h2", repo: "/work/app" }]]);
  });

  test("a reason the dialog does not expect never shows the host's words, and a known one shows its values as short plain text", async () => {
    const alertText = async (error: unknown) => {
      const { control } = open("en");
      await start("en");
      await shows(TEXT.en.secrets);
      await click(TEXT.en.move);
      await act(async () => {
        control.fail?.(error);
      });
      await settleMaybe(() => screen.queryByRole("alert") !== null);
      const text = screen.queryByRole("alert")?.textContent ?? "";
      cleanup();
      return text;
    };
    const unlisted = await alertText(
      new RequestError("invalid_state", "host says ghp_secret", "teleport_unlisted", {
        token: "ghp_secret",
      }),
    );
    const known = await alertText(
      new RequestError("bad_request", "x", "teleport_too_large", {
        max: `\u202e${"9".repeat(500)}`,
      }),
    );
    expect([
      unlisted.length > 0,
      unlisted.includes("ghp_secret"),
      known.startsWith("The transcript is larger than"),
      known.includes("\u202e"),
      known.length < 200,
    ]).toEqual([true, false, true, false, true]);
  });
});

const REASONS = {
  en: {
    none: "No other host can receive a session. Connect another host that is online and runs an up-to-date Flightdeck, then try again.",
    pick: "Pick the host to move the session to.",
    repo: "Type the repository on that host.",
  },
  "pt-BR": {
    none: "Nenhum outro host pode receber uma sessão. Conecte outro host que esteja online e com o Flightdeck atualizado e tente de novo.",
    pick: "Escolha o host para onde mover a sessão.",
    repo: "Digite o repositório nesse host.",
  },
} as const;

describe("teleport-dialog-ui: the dialog says why it cannot go on (#3725)", () => {
  for (const lang of ["en", "pt-BR"] as const) {
    const t = TEXT[lang];
    const why = REASONS[lang];

    test(`${lang}: with no host to move to, the dialog says so and offers no select or Continue`, async () => {
      const { calls } = open(lang, SUMMARY, false, []);
      expect(await shows(why.none)).toBe(true);
      expect(screen.queryByRole("combobox", { name: t.host })).toBeNull();
      expect(screen.queryByRole("button", { name: t.next })).toBeNull();
      // The dialog's own X has the same name: the form's button is the one that submits.
      const close = screen
        .queryAllByRole("button", { name: lang === "en" ? "Close" : "Fechar" })
        .find((b) => b.getAttribute("type") === "submit");
      expect(close).toBeDefined();
      await act(async () => {
        fireEvent.click(close as HTMLElement);
      });
      expect(calls.closed).toBe(1);
    });

    test(`${lang}: Continue off says to pick a host, then to type the repository, and the reason goes with the cause`, async () => {
      open(lang);
      expect(await shows(why.pick)).toBe(true);
      expect(screen.queryByRole("button", { name: t.next })?.hasAttribute("disabled")).toBe(true);
      const host = screen.queryByRole("combobox", { name: t.host });
      expect(host).not.toBeNull();
      await act(async () => {
        fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
      });
      expect(await shows(why.repo)).toBe(true);
      expect((document.body.textContent ?? "").includes(why.pick)).toBe(false);
      const repo = screen.queryByRole("textbox", { name: "repo-path" });
      expect(repo).not.toBeNull();
      await act(async () => {
        fireEvent.change(repo as HTMLElement, { target: { value: "/work/app" } });
      });
      expect((document.body.textContent ?? "").includes(why.repo)).toBe(false);
      expect(screen.queryByRole("button", { name: t.next })?.hasAttribute("disabled")).toBe(false);
    });
  }
});

/** The confirm step's own lines (#4125): the destination first, and the secrets count in the warning style. */
describe("teleport-dialog-ui: the summary says where the session goes and flags secrets (#4125)", () => {
  const TO = { en: "To: pi · /work/app", "pt-BR": "Para: pi · /work/app" } as const;
  const lines = () => [...document.querySelectorAll("form p")].map((p) => p.textContent ?? "");
  const secretsLine = () => screen.queryByText(/^(Lines that look like|Linhas que parecem) /);

  for (const lang of ["en", "pt-BR"] as const) {
    test(`${lang}: the first line names the host and the repository, the repository in monospace`, async () => {
      open(lang);
      await start(lang);
      await shows(TEXT[lang].secrets);
      expect(lines()[0]).toBe(TO[lang]);
      expect(document.querySelector("form p span.font-mono")?.textContent).toBe("/work/app");
    });
  }

  test("secret-looking lines above zero take the warning style", async () => {
    open("en");
    await start("en");
    await shows(TEXT.en.secrets);
    expect(secretsLine()?.className.includes("text-status-needs-you")).toBe(true);
  });

  test("no secret-looking lines leaves the line plain", async () => {
    open("en", { ...SUMMARY, secretLines: 0 });
    await start("en");
    await shows("Lines that look like secrets: 0");
    expect(secretsLine()).not.toBeNull();
    expect(secretsLine()?.className.includes("text-status-needs-you")).toBe(false);
  });

  test("a plain ws:// host still shows its warning on the summary", async () => {
    open("en", SUMMARY, false, [{ id: "h2", name: "pi" }], () => ["pi"]);
    await start("en");
    await shows(TEXT.en.secrets);
    expect(screen.queryByRole("status")?.textContent?.startsWith("pi connects without TLS")).toBe(
      true,
    );
  });
});

/** The dialog drops a host that goes offline in the first step, and its summary breaks a long path (#4495, #4496). */
describe("teleport-dialog-ui: a host that goes offline in the first step, a long path in the summary", () => {
  const dialog = (targets: ReadonlyArray<{ id: string; name: string }>) => (
    <TContext.Provider value={translator("en")}>
      <TeleportDialog
        targets={targets}
        repoField={(_hostId, value, onChange) => (
          <input aria-label="repo-path" value={value} onChange={(e) => onChange(e.target.value)} />
        )}
        run={(args) => {
          void args.confirm(SUMMARY);
          return new Promise<TeleportOutcome>(() => {});
        }}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </TContext.Provider>
  );

  test("a host picked and then gone offline is dropped: Continue is off and no repository is asked for it", async () => {
    const view = render(
      dialog([
        { id: "h2", name: "pi" },
        { id: "h3", name: "nas" },
      ]),
    );
    const host = screen.queryByRole("combobox", { name: "Host" });
    await act(async () => {
      fireEvent.change(host as HTMLElement, { target: { value: "h2" } });
    });
    await act(async () => {
      fireEvent.change(screen.queryByRole("textbox", { name: "repo-path" }) as HTMLElement, {
        target: { value: "/work/app" },
      });
    });
    await act(async () => {
      view.rerender(dialog([{ id: "h3", name: "nas" }]));
    });
    const continueOff = screen
      .queryByRole("button", { name: "Continue" })
      ?.hasAttribute("disabled");
    const repoField = screen.queryByRole("textbox", { name: "repo-path" }) !== null;
    expect({ continueOff, repoField }).toEqual({ continueOff: true, repoField: false });
  });

  test("the summary's repository and branch break inside the dialog instead of widening it", async () => {
    open("en", { ...SUMMARY, branch: "feature/a-very-long-branch-name-with-no-break-at-all" });
    await start("en");
    await shows(TEXT.en.secrets);
    const repo = document.querySelector("form p span.font-mono")?.className.includes("break-all");
    const branch = document.querySelector("form bdi.font-mono")?.className.includes("break-all");
    expect({ repo, branch }).toEqual({ repo: true, branch: true });
  });
});
