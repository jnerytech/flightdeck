import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { settleMaybe } from "../wait.ts";
import {
  act,
  asked,
  bar,
  button,
  card,
  cleanup,
  click,
  ctrl,
  dialog,
  dialogText,
  fireEvent,
  focusAt,
  li,
  press,
  ready,
  screen,
  setup,
  titleOf,
  within,
} from "./bulk-ui-setup.tsx";

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("board-bulk-ui: a narrow board (#1354)", () => {
  test("at 390 Move to and Discard go under ⋯, Clear is short, and the bar names cards in other columns", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(358);
    await ctrl("A", "B");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^In progress/ }));
    });
    await ctrl("D");
    const group = within(bar() as HTMLElement);
    expect([
      group.queryByRole("button", { name: "More actions for the selection" }) !== null,
      group.queryByRole("button", { name: "Move to…" }) !== null,
      group.queryByRole("button", { name: "Clear" }) !== null,
      (bar()?.textContent ?? "").includes("2 in other columns"),
    ]).toEqual([true, false, true, true]);
    restore();
  });

  test("pt-BR: Iniciar and Parar, and the confirm in Portuguese", async () => {
    const { restore } = setup({ language: "pt-BR" });
    await ready();
    await ctrl("A", "B");
    // The bar before the dialog opens: an open dialog hides the page from the accessibility tree.
    // The bar before the dialog opens hides it: Iniciar, and no Parar with nothing running.
    const labels = [...(bar("Seleção")?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent,
    );
    await click(button(bar("Seleção"), "Iniciar 2"));
    await settleMaybe(() => dialog() !== null);
    expect([
      screen.queryByRole("heading", { name: "Iniciar 2 cards?" }) !== null,
      labels.includes("Iniciar 2"),
      labels.some((label) => label?.startsWith("Parar")),
    ]).toEqual([true, true, false]);
    restore();
  });
});

/** Opens the Start confirm of A and B and waits for the host's limit. */
const openStart = async (language: "en" | "pt-BR" = "en") => {
  await ready();
  await ctrl("A", "B");
  const [group, start] = language === "en" ? ["Selection", "Start 2"] : ["Seleção", "Iniciar 2"];
  await click(button(bar(group), start));
  await settleMaybe(() => /fila|queue|agora|now/.test(dialogText()));
};
/** The queue line says a card starts now: "1 starts now", "All of them start now", "iniciam agora". */
const startsNow = () => /\b(now|agora)\b/.test(dialogText());

// #1414: what #1400 left out. The memory hold is read when the confirm opens, not only from a
// queued card's reason, and with any hold the queue line says they all wait.
describe("board-bulk-ui: the holds agree with the queue line (#1414)", () => {
  test("the host's hold holds with nothing queued yet: the memory line, and they all wait", async () => {
    const memory = { totalBytes: 100, freeBytes: 8, pauseAt: 0.9, holding: true };
    const en = setup({ memory });
    await openStart();
    await en.memoryRead();
    const english = [
      asked(en.requests),
      dialogText().includes("alfa is short of memory: new cards wait until it frees up."),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ];
    en.restore();
    cleanup();
    const pt = setup({ language: "pt-BR", memory });
    await openStart("pt-BR");
    await pt.memoryRead();
    expect([
      ...english,
      dialogText().includes("alfa está sem memória: os cards novos esperam ela liberar."),
      dialogText().includes("Eles entram na fila do board."),
      startsNow(),
    ]).toEqual([true, true, true, false, true, true, false]);
    pt.restore();
  });

  test("a margin under the share, the host still holds: the line follows the host, not the share", async () => {
    const { memoryRead, restore } = setup({
      memory: { totalBytes: 100, freeBytes: 11, pauseAt: 0.9, holding: true },
    });
    await openStart();
    await memoryRead();
    expect([dialogText().includes("alfa is short of memory"), startsNow()]).toEqual([true, false]);
    restore();
  });

  test("over the share but the host does not hold (no reading, as on macOS): no line, the split stands", async () => {
    const { memoryRead, restore } = setup({
      memory: { totalBytes: 100, freeBytes: 3, pauseAt: 0.9, holding: false },
    });
    await openStart();
    await memoryRead();
    expect([dialogText().includes("memory"), startsNow()]).toEqual([false, true]);
    restore();
  });

  test("an older host that does not say, or one without the hold: no memory line", async () => {
    const older = setup({ memory: { totalBytes: 100, freeBytes: 3, pauseAt: 0.9 } });
    await openStart();
    await older.memoryRead();
    const silent = [asked(older.requests), dialogText().includes("memory"), startsNow()];
    older.restore();
    cleanup();
    const none = setup();
    await openStart();
    await none.memoryRead();
    expect([...silent, asked(none.requests), dialogText().includes("memory")]).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
    none.restore();
  });

  test("the quota over its pause limit: the queue line says they all wait, in both languages", async () => {
    const en = setup({ quota: true, used: 0.95 });
    await openStart();
    const english = [
      dialogText().includes("alfa is over its pause limit"),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ];
    en.restore();
    cleanup();
    const pt = setup({ language: "pt-BR", quota: true, used: 0.95 });
    await openStart("pt-BR");
    expect([
      ...english,
      dialogText().includes("alfa passou do limite de pausa"),
      dialogText().includes("Eles entram na fila do board."),
      startsNow(),
    ]).toEqual([true, true, false, true, true, false]);
    pt.restore();
  });

  test("a budget that holds: the queue line says they all wait", async () => {
    const { restore } = setup({
      budgets: [{ id: "b", scope: "host", projectKey: null, action: "queue", fraction: 1 }],
    });
    await openStart();
    expect([
      dialogText().includes("alfa reached a budget that holds new cards"),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ]).toEqual([true, true, false]);
    restore();
  });
});

const pressEscape = () =>
  act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  });

// #1426 (round 10 of #168): closing a confirm left the focus on the page body, so a keyboard user
// started again from the top. It goes back to where the person was.
describe("board-bulk-ui: the focus after a confirm closes (#1426)", () => {
  test("s on a card, then Esc: the focus is back on that card", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "C");
    titleOf("C")?.focus();
    await press("s");
    await settleMaybe(() => dialog() !== null);
    await pressEscape();
    await settleMaybe(() => dialog() === null && focusAt().card === "C");
    expect([dialog() === null, focusAt().card, focusAt().open]).toEqual([true, "C", true]);
    restore();
  });

  test("the bar's Start N, then Cancel: the focus is back on Start N", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "B");
    const start = button(bar(), "Start 2");
    start.focus();
    await click(start);
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Cancel"));
    await settleMaybe(() => dialog() === null && focusAt().text === "Start 2");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Start 2"]);
    restore();
  });

  test("the bar's Stop N, then Esc: the focus is back on Stop N", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "D");
    const stop = button(bar(), "Stop 1");
    stop.focus();
    await click(stop);
    await settleMaybe(() => dialog() !== null);
    await pressEscape();
    await settleMaybe(() => dialog() === null && focusAt().text === "Stop 1");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Stop 1"]);
    restore();
  });

  test("Discard…, then Cancel: the focus is back on Discard…", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "B");
    const discard = button(bar(), "Discard…");
    discard.focus();
    await click(discard);
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Cancel"));
    await settleMaybe(() => dialog() === null && focusAt().text === "Discard…");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Discard…"]);
    restore();
  });
});

describe("board-bulk-ui: the conflict radar badge on a card (#1405)", () => {
  test("a card the host says may conflict with another shows it; the others show nothing", async () => {
    const { restore } = setup({
      cards: [
        card("A", "backlog", 1, {
          mayConflict: [{ cardId: "B", title: "B", files: ["src/a.ts"] }],
        }),
        card("B", "backlog", 2),
      ],
    });
    await ready();
    expect([
      li("A").textContent?.includes("May conflict with B"),
      li("B").textContent?.includes("May conflict"),
    ]).toEqual([true, false]);
    restore();
  });
});
