import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionView } = await import("../src/ui/SessionView.tsx");
const { emptySession } = await import("../src/lib/session-state.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(20_000);
afterEach(cleanup);

interface Setup {
  start?: string;
  bypass?: boolean;
  lang?: "en" | "pt-BR";
  noSettings?: boolean;
  runtime?: "claude" | "opencode";
}

/** The open session with the mode chip: what it was asked to change, and where the host settings link went. */
function view({
  start = "default",
  bypass = false,
  lang = "en",
  noSettings = false,
  runtime = "claude",
}: Setup = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const t = translator(lang);
  render(
    <TContext.Provider value={t}>
      <SessionView
        title="refactor"
        t={t}
        session={{ ...emptySession(), status: "idle", permissionMode: start as never }}
        actions={{
          send: async () => {},
          interrupt: async () => {},
          close: async () => {},
          resume: async () => {},
          respond: async () => {},
          setMode: async (mode) => void calls.push(mode),
        }}
        settings={!noSettings}
        runtime={runtime}
        {...(bypass ? { bypass: { host: "pc" } } : {})}
        onOpenHostSettings={() => void opened.push("host")}
      />
    </TContext.Provider>,
  );
  return { calls, opened };
}

const chip = (name = /^(Permission mode|Modo de permissão):/) =>
  screen.queryByRole("button", { name });

/** A Radix menu opens on pointer down. */
const open = async () => {
  const trigger = chip();
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(trigger as HTMLElement);
  });
};
const rows = () => screen.queryAllByRole("menuitemradio");
const row = (name: RegExp | string) => screen.queryByRole("menuitemradio", { name });
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("modo-chip: the chip under the composer", () => {
  test("it shows the current mode as a labelled button, with a tooltip that says what the mode does", () => {
    view({ start: "plan" });
    const button = chip();
    expect(button?.getAttribute("aria-label")).toBe("Permission mode: Plan");
    expect(button?.textContent).toContain("Plan");
    expect(button?.getAttribute("title")).toBe("Only reads and proposes a plan; changes nothing");
    expect(screen.queryByLabelText("Permission mode")).toBeNull();
  });

  test("a session that cannot change its settings shows the mode as plain text, no chip", () => {
    view({ noSettings: true });
    expect(chip()).toBeNull();
  });

  test("in Portuguese the chip and its name are in Portuguese", () => {
    view({ lang: "pt-BR", start: "acceptEdits" });
    expect(chip()?.getAttribute("aria-label")).toBe("Modo de permissão: Aceitar edições");
  });

  test("with bypass on, the chip is in the warning color", () => {
    view({ start: "bypassPermissions", bypass: true });
    expect(chip()?.getAttribute("data-bypass")).toBe("true");
    expect(chip()?.className).toContain("text-status-error");
  });
});

describe("modo-chip: the mode menu", () => {
  test("it has a title and one row per mode, each with its name, what it does and its number", async () => {
    view({ start: "default", bypass: true });
    await open();
    expect(screen.queryByText("Mode")).not.toBeNull();
    const list = rows();
    expect(list.map((r) => r.textContent)).toEqual([
      "DefaultAsks before it edits files or runs commands1",
      "Accept editsEdits files without asking; still asks before running commands2",
      "PlanOnly reads and proposes a plan; changes nothing3",
      "Bypass permissionsRuns everything without asking. Only in a folder you can throw away4",
    ]);
  });

  test("the current mode is the checked one", async () => {
    view({ start: "acceptEdits", bypass: true });
    await open();
    expect(rows().map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
  });

  test("picking a mode changes it at once and the chip follows", async () => {
    const { calls } = view({ start: "default", bypass: true });
    await open();
    await click(row(/^Accept edits/));
    expect(calls).toEqual(["acceptEdits"]);
    expect(chip()?.textContent).toContain("Accept edits");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  test("a number key picks the row with that number", async () => {
    const { calls } = view({ start: "default", bypass: true });
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "3" });
    });
    expect(calls).toEqual(["plan"]);
  });

  test("an OpenCode session has no accept-edits mode: the menu lists the others, renumbered", async () => {
    const { calls } = view({ start: "default", bypass: true, runtime: "opencode" });
    await open();
    expect(rows().map((r) => r.textContent)).toEqual([
      "DefaultAsks before it edits files or runs commands1",
      "PlanOnly reads and proposes a plan; changes nothing2",
      "Bypass permissionsRuns everything without asking. Only in a folder you can throw away3",
    ]);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "2" });
    });
    expect(calls).toEqual(["plan"]);
  });

  test("the key 4 asks before bypass, and changes nothing until it is confirmed", async () => {
    const { calls } = view({ start: "default", bypass: true });
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "4" });
    });
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    expect(calls).toEqual([]);
  });

  test("the key 4 does nothing on a host that does not allow bypass, and neither does a key past the last row", async () => {
    const { calls } = view({ start: "default" });
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("menu"), { key: "4" });
      fireEvent.keyDown(screen.getByRole("menu"), { key: "5" });
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("on a host that does not allow bypass, it is listed but blocked, with the reason and a way to turn it on", async () => {
    const { calls, opened } = view({ start: "default" });
    await open();
    const bypass = row(/^Bypass permissions/);
    expect(bypass?.getAttribute("aria-disabled")).toBe("true");
    expect(bypass?.textContent).toContain("Turned off on this host");
    await click(bypass);
    expect(calls).toEqual([]);
    await click(screen.queryByRole("menuitem", { name: "Turn it on in the host settings" }));
    expect(opened).toEqual(["host"]);
  });

  test("on such a host a mode looser than the start mode is blocked too", async () => {
    const { calls } = view({ start: "plan" });
    await open();
    const accept = row(/^Accept edits/);
    expect(accept?.getAttribute("aria-disabled")).toBe("true");
    expect(accept?.textContent).toContain("Looser than the mode this session started in");
    await click(accept);
    expect(calls).toEqual([]);
  });
});

describe("modo-chip: bypass asks first", () => {
  test("it asks each time, naming the host and the session; Cancel changes nothing", async () => {
    const { calls } = view({ start: "plan", bypass: true });
    await open();
    await click(row(/^Bypass permissions/));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent ?? "").toContain("pc");
    expect(dialog.textContent ?? "").toContain("refactor");
    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect(chip()?.getAttribute("aria-label")).toBe("Permission mode: Plan");
  });

  test("confirming switches to bypass and turns the chip to the warning color", async () => {
    const { calls } = view({ start: "plan", bypass: true });
    await open();
    await click(row(/^Bypass permissions/));
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Switch to bypass" }),
    );
    expect(calls).toEqual(["bypassPermissions"]);
    expect(chip()?.getAttribute("data-bypass")).toBe("true");
  });
});

describe("modo-chip: Shift+Tab", () => {
  test("on an OpenCode session it goes from default to plan, never to accept edits", async () => {
    const { calls } = view({ start: "default", bypass: true, runtime: "opencode" });
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Tab", shiftKey: true });
    });
    expect(calls).toEqual(["plan"]);
  });

  const box = () => screen.getByRole("textbox", { name: "Message" });
  const shiftTab = async () => {
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Tab", shiftKey: true });
    });
  };

  test("in the message box it goes default, accept edits, plan, and round again", async () => {
    const { calls } = view({ start: "default", bypass: true });
    await shiftTab();
    await shiftTab();
    await shiftTab();
    expect(calls).toEqual(["acceptEdits", "plan", "default"]);
  });

  test("it never lands on bypass", async () => {
    const { calls } = view({ start: "plan", bypass: true });
    await shiftTab();
    await shiftTab();
    expect(calls).toEqual(["default", "acceptEdits"]);
  });

  test("it skips what the host does not allow, and does nothing when nothing is left", async () => {
    const { calls } = view({ start: "plan" });
    await shiftTab();
    expect(calls).toEqual([]);
  });

  test("the chip announces the shortcut", () => {
    view({});
    expect(chip()?.getAttribute("aria-keyshortcuts")).toBe("Shift+Tab");
  });
});

/** A view that stays mounted while the session's state arrives or another session takes its place (#935). */
function live(lang: "en" | "pt-BR" = "en") {
  const calls: string[] = [];
  const t = translator(lang);
  const ui = (mode: string | undefined, key: string) => (
    <TContext.Provider value={t}>
      <SessionView
        title="refactor"
        t={t}
        scrollKey={key}
        session={{
          ...emptySession(),
          status: "idle",
          ...(mode ? { permissionMode: mode as never } : {}),
        }}
        actions={{
          send: async () => {},
          interrupt: async () => {},
          close: async () => {},
          resume: async () => {},
          respond: async () => {},
          setMode: async (next) => void calls.push(next),
        }}
        settings
        runtime="claude"
      />
    </TContext.Provider>
  );
  const { rerender } = render(ui(undefined, "h/s1"));
  return {
    calls,
    show: (mode: string | undefined, key = "h/s1") => act(() => rerender(ui(mode, key))),
  };
}

describe("modo-chip: the chip shows the session's real mode (#935)", () => {
  test("before the session says its mode, the chip says it is unknown, never Default", () => {
    live();
    expect(chip()?.getAttribute("aria-label") ?? "").toBe("Permission mode: Unknown");
  });

  test("a session a persona opened in plan shows Plan once its mode arrives, in both languages", async () => {
    const en = live();
    await en.show("plan");
    const english = chip()?.getAttribute("aria-label") ?? "";
    cleanup();
    const pt = live("pt-BR");
    expect(chip()?.getAttribute("aria-label") ?? "").toBe("Modo de permissão: Desconhecido");
    await pt.show("plan");
    expect([english, chip()?.getAttribute("aria-label") ?? ""]).toEqual([
      "Permission mode: Plan",
      "Modo de permissão: Planejar",
    ]);
  });

  test("each session keeps its own pick: another session of the same start shows its own, and the first keeps its pick", async () => {
    const { show } = live();
    const pick = async (name: RegExp) => {
      await open();
      await click(row(name));
    };
    await show("acceptEdits");
    await pick(/^Default/);
    await show("acceptEdits", "h/s2");
    const other = chip()?.textContent ?? "";
    await pick(/^Plan/);
    await show("acceptEdits", "h/s1");
    expect([other.includes("Accept edits"), chip()?.textContent?.includes("Default")]).toEqual([
      true,
      true,
    ]);
  });

  test("while the mode is unknown, no mode is blocked as looser than the start", async () => {
    live();
    await open();
    expect([row(/^Accept edits/)?.getAttribute("aria-disabled") ?? "false", rows().length]).toEqual(
      ["false", 4],
    );
  });

  test("a mode picked in one session does not follow the view to another session", async () => {
    const { show } = live();
    await show("default");
    await open();
    // Plan, stricter than the start: a host without bypass lets it through.
    await click(row(/^Plan/));
    const picked = chip()?.textContent ?? "";
    await show("acceptEdits", "h/s2");
    expect([picked.includes("Plan"), chip()?.textContent?.includes("Accept edits")]).toEqual([
      true,
      true,
    ]);
  });
});
