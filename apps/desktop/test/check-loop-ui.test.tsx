import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card, CheckLoopSwitch } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { CheckLoopPanel } = await import("../src/features/board/check-loop-panel.tsx");
const { checkLoopLine } = await import("../src/features/board/check-loop.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1361 (app slice A2): the card's switch for "keep going until the checks pass", a
 * confirmation when the host asks for one, and a line that says how the loop goes
 * (docs/decisions/2026-11-09-check-loop.md).
 */
const loop = (over: Partial<CheckLoopSwitch> = {}): CheckLoopSwitch => ({
  on: false,
  rounds: null,
  confirmed: false,
  active: null,
  round: 0,
  max: 3,
  last: null,
  ...over,
});

type Answer =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; reason?: string; params?: Record<string, string> };

function setup(
  options: {
    language?: "en" | "pt-BR";
    checkLoop?: CheckLoopSwitch;
    answers?: Answer[];
    /** What `host.info` says of the app's connection (#1361); absent from an older host. */
    near?: boolean;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const sent: Array<[string, unknown]> = [];
  const answers = [...(options.answers ?? [])];
  store.hostRequest = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    return answers.shift() ?? { ok: true, data: {} };
  }) as never;
  const card = {
    id: "c1",
    projectId: "p1",
    checkLoop: options.checkLoop ?? loop(),
  } as unknown as Card;
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <CheckLoopPanel store={store} hostId="h1" card={card} near={options.near} />
    </TContext.Provider>
  );
  return { store, sent, view };
}

const theSwitch = () => screen.queryByRole("switch") as HTMLButtonElement | null;
async function click(target: HTMLElement | null) {
  if (target) await act(async () => fireEvent.click(target));
  return target !== null;
}

describe("check-loop-ui: the line that says how the loop goes", () => {
  test("off says nothing; on says ready, checking, the round of max, or how it ended", () => {
    const line = (value: CheckLoopSwitch) => checkLoopLine(value);
    expect([
      line(loop()),
      line(loop({ on: true })),
      line(loop({ on: true, active: "checking" })),
      line(loop({ on: true, active: "fixing", round: 2, max: 3 })),
      line(
        loop({
          on: true,
          last: {
            state: "ended",
            reason: "rounds_spent",
            command: "bun test",
            exitCode: 1,
            at: "t",
          },
        }),
      ),
      line(
        loop({
          on: true,
          last: { state: "ended", reason: null, command: null, exitCode: null, at: "t" },
        }),
      ),
    ]).toEqual([
      null,
      { key: "checkLoopUi.ready", params: {} },
      { key: "checkLoopUi.checking", params: {} },
      { key: "checkLoopUi.fixing", params: { round: 2, max: 3 } },
      { key: "checkLoopUi.ended.rounds_spent", params: { max: 3, command: "bun test" } },
      { key: "checkLoopUi.ready", params: {} },
    ]);
  });
});

describe("check-loop-ui: every reason a loop ends with has its text", () => {
  test("each CheckLoopReason the daemon may send is named in en and pt-BR", async () => {
    const { CheckLoopReason } = await import("@flightdeck/protocol");
    const { en } = await import("../src/i18n/en.ts");
    const { ptBR } = await import("../src/i18n/pt-BR.ts");
    const missing = (dict: { checkLoopUi?: { ended?: Record<string, string> } }) =>
      CheckLoopReason.options.filter((reason) => !dict.checkLoopUi?.ended?.[reason]);
    expect([missing(en), missing(ptBR)]).toEqual([[], []]);
  });
});

describe("check-loop-ui: the switch on the card", () => {
  test("turning it on asks the host; when the host wants a confirmation, the dialog says why and confirming sends it", async () => {
    const { view, sent } = setup({
      answers: [
        { ok: false, code: "invalid_state", message: "x", reason: "check_loop_confirm" },
        { ok: true, data: {} },
      ],
    });
    render(view);
    await click(theSwitch());
    const asked = await settleMaybe(() => screen.queryByRole("alertdialog") !== null, 3000);
    const why = screen.queryByText(/without asking you each time/) !== null;
    await click(screen.queryByRole("button", { name: "Turn on" }));
    await settleMaybe(() => sent.length === 2, 3000);
    expect([asked, why, sent]).toEqual([
      true,
      true,
      [
        ["card.checkLoop", { cardId: "c1", on: true }],
        ["card.checkLoop", { cardId: "c1", on: true, confirm: true }],
      ],
    ]);
  });

  test("another refusal is said in place, in the person's language; turning it off sends off", async () => {
    const refused = setup({
      answers: [{ ok: false, code: "invalid_state", message: "x", reason: "check_loop_no_checks" }],
    });
    render(refused.view);
    await click(theSwitch());
    const said = await settleMaybe(
      () =>
        screen
          .queryAllByRole("alert")
          .some((box) => /no checks to run/.test(box.textContent ?? "")),
      3000,
    );
    cleanup();
    const on = setup({ checkLoop: loop({ on: true }) });
    render(on.view);
    await click(theSwitch());
    await settleMaybe(() => on.sent.length === 1, 3000);
    expect([said, on.sent]).toEqual([true, [["card.checkLoop", { cardId: "c1", on: false }]]]);
  });

  test("the switch has its name, shows the card's state, and the line is in Portuguese for pt-BR", () => {
    const { view } = setup({
      language: "pt-BR",
      checkLoop: loop({ on: true, active: "fixing", round: 1, max: 3 }),
    });
    render(view);
    const control = screen.queryByRole("switch", { name: "Continuar até os checks passarem" });
    expect([
      control !== null,
      control?.getAttribute("aria-checked"),
      screen.queryByText(/Rodada 1 de 3/) !== null,
    ]).toEqual([true, "true", true]);
  });

  test("the switch's text is its label: clicking it toggles the switch, and the name is said once", async () => {
    const { view, sent } = setup({ checkLoop: loop({ on: true }) });
    render(view);
    await click(screen.queryByText("Keep going until the checks pass"));
    await settleMaybe(() => sent.length === 1, 3000);
    const named = document.querySelectorAll(
      '[aria-label="Keep going until the checks pass"]',
    ).length;
    expect([sent, named]).toEqual([[["card.checkLoop", { cardId: "c1", on: false }]], 0]);
  });

  test("a card from a host without the loop shows nothing", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    const card = { id: "c1", projectId: "p1" } as unknown as Card;
    render(
      <TContext.Provider value={store.i18n.t}>
        <CheckLoopPanel store={store} hostId="h1" card={card} />
      </TContext.Provider>,
    );
    expect(theSwitch()).toBe(null);
  });
});

describe("check-loop-ui: over a far connection (#1361)", () => {
  const HINT = "Turn it on from this computer or over Tailscale.";
  test("an off switch cannot be turned on and says where it can; an on switch can still be turned off", async () => {
    const off = setup({ near: false });
    render(off.view);
    const switchOff = theSwitch();
    const hint = screen.queryByText(HINT);
    const offState = [
      switchOff?.disabled,
      hint !== null &&
        (switchOff?.getAttribute("aria-describedby") ?? "").split(" ").includes(hint.id),
    ];
    cleanup();
    const on = setup({ near: false, checkLoop: loop({ on: true }) });
    render(on.view);
    const switchOn = theSwitch();
    const onDisabled = switchOn?.disabled;
    await click(switchOn);
    expect([...offState, onDisabled, on.sent]).toEqual([
      true,
      true,
      false,
      [["card.checkLoop", { cardId: "c1", on: false }]],
    ]);
  });

  test("a near connection, or a host that does not say, keeps the switch as it was", () => {
    const states = [true, undefined].map((near) => {
      const { view } = setup(near === undefined ? {} : { near });
      render(view);
      const state = [theSwitch()?.disabled, screen.queryByText(HINT) === null];
      cleanup();
      return state;
    });
    expect(states).toEqual([
      [false, true],
      [false, true],
    ]);
  });
});
