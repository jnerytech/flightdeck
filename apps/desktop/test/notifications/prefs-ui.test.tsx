import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { unfoldAll } from "../unfold.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { Settings } = await import("../../src/features/settings/page.tsx");
const { SessionsHub } = await import("../../src/features/sessions/sessions-hub.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const host = (id: string, name: string) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function settings(language: "en" | "pt-BR" = "en") {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(patch: object): void }).update({
    hosts: [host("h1", "alfa"), host("h2", "beta")],
    projects: {
      h1: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main" }],
      h2: [],
    },
  });
  render(
    <Settings
      store={store}
      settings={{ ...store.getState().settings, updaterSupported: true }}
      onCloseToTray={() => {}}
      onAutostart={() => {}}
      onGlobalShortcut={() => {}}
      onShortcuts={() => {}}
      appUpdate={{ upToDate: false } as never}
      onCheckUpdate={() => {}}
      onNotifyUpdates={() => {}}
      onAutoUpdate={() => {}}
      theme="system"
      onTheme={() => {}}
      density="comfortable"
      onDensity={() => {}}
      lang={language}
      onLang={() => {}}
      t={store.i18n.t}
    />,
  );
  return { store, mem };
}

const panel = () => screen.getByRole("region", { name: "Notifications" });
const box = (name: string) => within(panel()).getByRole("checkbox", { name }) as HTMLInputElement;
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("notify-prefs-ui: Settings has a Notifications section (issue #149)", () => {
  test("it is on the rail and the search finds it by its words", () => {
    settings();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  test("a master switch and one switch per event, all on, each saved when changed", async () => {
    const { store } = settings();
    for (const name of [
      "Show notifications",
      "Needs you",
      "Turn finished",
      "Session failed",
      "PR watch",
      "Budget and quota",
    ]) {
      expect(box(name).checked).toBe(true);
    }
    await click(box("Turn finished"));
    expect(store.notifyPrefs.value.events["turn-finished"]).toBe(false);
    expect(store.notifyPrefs.value.events["needs-you"]).toBe(true);
    await click(box("Show notifications"));
    expect(store.notifyPrefs.value.enabled).toBe(false);
    // The event switches say they follow the master one.
    expect(box("Needs you").disabled).toBe(false);
  });

  test("the team rule is on by default and can be turned off", async () => {
    const { store } = settings();
    const fold = box("Fold a team's finished workers into one message");
    expect(fold.checked).toBe(true);
    await click(fold);
    expect(store.notifyPrefs.value.teamFold).toBe(false);
  });

  test("hosts and projects can be muted from lists, and unmuted", async () => {
    const { store } = settings();
    await click(box("Mute alfa"));
    await click(box("Mute api (alfa)"));
    expect(store.notifyPrefs.value.mutedHosts).toEqual(["h1"]);
    expect(store.notifyPrefs.value.mutedProjects).toEqual(["h1/p-api"]);
    expect(box("Mute alfa").checked).toBe(true);
    await click(box("Mute alfa"));
    expect(store.notifyPrefs.value.mutedHosts).toEqual([]);
    expect(within(panel()).queryByRole("checkbox", { name: /Mute beta/ })).not.toBeNull();
  });

  test("a muted session shows in the list with a button that unmutes it", async () => {
    const { store } = settings();
    act(() => store.notifyPrefs.muteSession("h1/abc", true));
    await click(within(panel()).getByRole("button", { name: "Unmute h1/abc" }));
    expect(store.notifyPrefs.value.mutedSessions).toEqual([]);
  });
});

describe("notify-prefs-ui: the master switch and what it governs (issue #4005)", () => {
  const described = (el: HTMLElement) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .filter(Boolean);
  const OFF_NOTE =
    "Show notifications is off, so there is no system notification and no sound. What you choose under Tell me about, Fold and Mute still decides what the bell keeps.";

  test("the master switch is read with its hint", () => {
    settings();
    expect(described(box("Show notifications"))).toEqual([
      "System notifications and the sound. The bell keeps its entries.",
    ]);
  });

  test("with it off the sound, volume, file and test are disabled with a reason, and the bell's own choices stay live", async () => {
    settings();
    await pickSound("file");
    const state = () => {
      const select = within(panel()).getByLabelText("Sound") as HTMLSelectElement;
      const volume = within(panel()).getByLabelText("Volume") as HTMLInputElement;
      const file = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
      const test = within(panel()).getByRole("button", { name: "Send test notification" });
      return {
        disabled: [select, volume, file, test].map((el) => (el as HTMLInputElement).disabled),
        reasons: [select, volume, file].map((el) => described(el).includes(OFF_NOTE)),
        note: within(panel()).queryByText(OFF_NOTE) !== null,
        testReason:
          within(panel()).queryByText("Turn on Show notifications to send a test.") !== null,
        bell: [
          box("Needs you").disabled,
          box("Fold a team's finished workers into one message").disabled,
        ],
      };
    };
    const on = state();
    await click(box("Show notifications"));
    const off = state();
    await click(box("Show notifications"));
    expect([on, off, state()]).toEqual([
      {
        disabled: [false, false, false, false],
        reasons: [false, false, false],
        note: false,
        testReason: false,
        bell: [false, false],
      },
      {
        disabled: [true, true, true, true],
        reasons: [true, true, true],
        note: true,
        testReason: true,
        bell: [false, false],
      },
      {
        disabled: [false, false, false, false],
        reasons: [false, false, false],
        note: false,
        testReason: false,
        bell: [false, false],
      },
    ]);
  });

  test("it reads in Portuguese", async () => {
    settings("pt-BR");
    await click(
      within(screen.getByRole("region", { name: "Notificações" })).getByRole("checkbox", {
        name: "Mostrar notificações",
      }),
    );
    expect(
      within(screen.getByRole("region", { name: "Notificações" })).queryByText(
        "Ligue Mostrar notificações para enviar um teste.",
      ) !== null,
    ).toBe(true);
  });
});

describe("notify-prefs-ui: the mutes the lists cannot show (issue #4007)", () => {
  const rows = () =>
    [...panel().querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((name) => name.startsWith("Unmute"));

  test("a mute for a host or project that is not in the lists shows with a button that clears it", async () => {
    const { store } = settings();
    act(() => {
      store.notifyPrefs.muteHost("gone", true);
      store.notifyPrefs.muteProject("h2/p9", true);
    });
    const before = rows();
    for (const name of ["Unmute gone", "Unmute h2/p9"]) {
      const button = within(panel()).queryByRole("button", { name });
      if (button) await click(button);
    }
    expect([
      before,
      rows(),
      store.notifyPrefs.value.mutedHosts,
      store.notifyPrefs.value.mutedProjects,
    ]).toEqual([["Unmute gone", "Unmute h2/p9"], [], [], []]);
  });

  test("with no host and nothing muted a line says there is nothing to mute", () => {
    const { store } = settings();
    const line = () =>
      within(panel()).queryByText("Nothing to mute yet: add a host first.") !== null;
    const withHosts = line();
    act(() =>
      (store as unknown as { update(patch: object): void }).update({ hosts: [], projects: {} }),
    );
    expect([withHosts, line()]).toEqual([false, true]);
  });

  test("each host has a group of its own, its own mute first, then its projects", () => {
    settings();
    const group = within(panel()).queryByRole("group", { name: "alfa" });
    expect(
      [...(group?.querySelectorAll("input") ?? [])].map(
        (input) => input.closest("label")?.textContent ?? "",
      ),
    ).toEqual(["Mute alfa", "Mute api (alfa)"]);
    expect(within(panel()).queryByRole("group", { name: "beta" }) !== null).toBe(true);
  });
});

const pickSound = (mode: "off" | "system" | "file") =>
  act(async () => {
    fireEvent.change(within(panel()).getByLabelText("Sound"), { target: { value: mode } });
  });

describe("notify-prefs-ui: the sound (issue #149)", () => {
  test("off, system default or a file, with a volume, saved when changed", async () => {
    const { store } = settings();
    const select = within(panel()).getByLabelText("Sound") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Off",
      "System default",
      "A file",
    ]);
    expect(select.value).toBe("off");
    await act(async () => {
      fireEvent.change(select, { target: { value: "system" } });
    });
    expect(store.notifyPrefs.value.sound.mode).toBe("system");
    const volume = within(panel()).getByLabelText("Volume") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(volume, { target: { value: "80" } });
    });
    expect(store.notifyPrefs.value.sound.volume).toBeCloseTo(0.8);
  });

  test("the volume and the file chooser are live only for the sound that uses them, and say why when not (#3865)", async () => {
    settings();
    const state = () => {
      const volume = within(panel()).getByLabelText("Volume") as HTMLInputElement;
      const file = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
      const hint = (el: HTMLElement) =>
        document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
      return {
        volume: [volume.disabled, hint(volume)],
        file: [file.disabled, hint(file)],
      };
    };
    const seen = [state()];
    await pickSound("system");
    seen.push(state());
    await pickSound("file");
    seen.push(state());
    expect(seen).toEqual([
      {
        volume: [true, "Pick a sound to set the volume."],
        file: [true, 'Choose "A file" to pick one.'],
      },
      { volume: [false, null], file: [true, 'Choose "A file" to pick one.'] },
      { volume: [false, null], file: [false, null] },
    ]);
  });

  test("a file kept earlier stays shown while the chooser is disabled (#3865)", async () => {
    const { store } = settings();
    await pickSound("file");
    const input = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "ding.mp3", { type: "audio/mpeg" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(store.notifyPrefs.value.sound.fileName).toBe("ding.mp3"));
    await pickSound("system");
    expect(within(panel()).queryByText("ding.mp3")).not.toBeNull();
  });

  test("the volume shows as a percentage that follows the slider (#3865)", async () => {
    const { store } = settings();
    await pickSound("system");
    const volume = within(panel()).getByLabelText("Volume") as HTMLInputElement;
    const shown = () => ["50%", "60%"].filter((v) => within(panel()).queryByText(v) !== null);
    const first = shown();
    await act(async () => {
      fireEvent.change(volume, { target: { value: "60" } });
    });
    expect([first, shown(), store.notifyPrefs.value.sound.volume]).toEqual([["50%"], ["60%"], 0.6]);
  });

  test("leaving the file sound clears a file error, and the slider reads its percentage (#3865)", async () => {
    settings();
    await pickSound("file");
    const input = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
    const text = new File(["x"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [text] } });
    });
    const shown = within(panel()).queryByRole("alert") !== null;
    await pickSound("system");
    const volume = within(panel()).getByLabelText("Volume") as HTMLInputElement;
    expect([
      shown,
      within(panel()).queryByRole("alert") !== null,
      volume.getAttribute("aria-valuetext"),
    ]).toEqual([true, false, "50%"]);
  });

  test("a file over the cap is refused before it is read", async () => {
    const { store } = settings();
    await pickSound("file");
    const input = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
    const big = new File([new Uint8Array(500_000)], "long.wav", { type: "audio/wav" });
    let read = false;
    Object.defineProperty(big, "arrayBuffer", {
      value: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [big] } });
    });
    expect(within(panel()).getByRole("alert").textContent).toBe(
      "That file is too large to keep (about 400 KB at most).",
    );
    expect(read).toBe(false);
    expect(store.notifyPrefs.value.sound.fileName).toBeNull();
  });

  test("choosing a file keeps it and shows its name; a file that is not audio is refused", async () => {
    const { store } = settings();
    await pickSound("file");
    const input = within(panel()).getByLabelText("Choose a sound file") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "ding.mp3", { type: "audio/mpeg" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(store.notifyPrefs.value.sound.fileName).toBe("ding.mp3"));
    expect(store.notifyPrefs.value.sound.mode).toBe("file");
    expect(store.notifyPrefs.soundFile()).toContain("data:");
    expect(within(panel()).getByText("ding.mp3")).toBeTruthy();
    const text = new File(["x"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [text] } });
    });
    expect(within(panel()).getByRole("alert").textContent).toBe(
      "That is not a sound file (MP3, WAV, OGG, M4A, AAC or FLAC).",
    );
    expect(store.notifyPrefs.value.sound.fileName).toBe("ding.mp3");
  });
});

describe("notify-prefs-ui: the test notification answers each press (issue #4006)", () => {
  const testButton = () => within(panel()).getByRole("button", { name: "Send test notification" });
  const result = () => within(panel()).getByRole("status").textContent;

  test("the button is busy until the test answers, a second press sends nothing, and each answer is announced again", async () => {
    const { store } = settings();
    const answers: Array<(v: "delivered" | "blocked") => void> = [];
    store.inbox.sendTest = () => new Promise((resolve) => answers.push(resolve));
    await click(testButton());
    await click(testButton());
    const busy = [(testButton() as HTMLButtonElement).disabled, answers.length];
    await act(async () => answers[0]?.("delivered"));
    await settle(() => result() === "Delivered.");
    await click(testButton());
    const cleared = result();
    await act(async () => answers[1]?.("delivered"));
    await settle(() => result() === "Delivered.");
    expect([busy, cleared, result(), (testButton() as HTMLButtonElement).disabled]).toEqual([
      [true, 1],
      "",
      "Delivered.",
      false,
    ]);
  });
});

describe("notify-prefs-ui: the test notification (issue #149)", () => {
  test("delivered", async () => {
    settings();
    await click(within(panel()).getByRole("button", { name: "Send test notification" }));
    await settle(() => within(panel()).getByRole("status").textContent === "Delivered.");
    expect(within(panel()).getByRole("status").textContent).toBe("Delivered.");
  });

  test("not displayed: it says so and names the Windows setting", async () => {
    const { mem } = settings();
    const api = mem.win.Notification as unknown as {
      permission: string;
      requestPermission: () => Promise<string>;
    };
    api.permission = "denied";
    api.requestPermission = async () => "denied";
    await click(within(panel()).getByRole("button", { name: "Send test notification" }));
    await settle(() => (within(panel()).getByRole("status").textContent ?? "") !== "");
    const text = within(panel()).getByRole("status").textContent ?? "";
    expect(text).toContain("Not displayed.");
    expect(text).toContain("Notifications are blocked for Flightdeck");
    expect(text).toContain("Settings → System → Notifications");
  });

  test("it reads in Portuguese", () => {
    settings("pt-BR");
    expect(
      within(screen.getByRole("region", { name: "Notificações" })).getByRole("button", {
        name: "Enviar notificação de teste",
      }),
    ).toBeTruthy();
  });
});

const external = (id: string) => ({
  claudeSessionId: id,
  cwd: `/work/${id}`,
  projectKey: `host:alfa:/work/${id}`,
  status: "idle",
  controllable: false,
  lastEventAt: "2026-11-04T10:00:00.000Z",
  summary: null,
  persona: null,
});

describe("notify-prefs-ui: mute or snooze one session from its menu (issue #149)", () => {
  async function hub() {
    const mem = memoryPlatform(false, "en");
    mem.platform.storage.setItem("flightdeck.hubOpen", "{}");
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000, now: () => 1_000_000 });
    store.i18n.start();
    const state = {
      ...store.getState(),
      hosts: [host("alfa", "alfa")],
      externals: { "alfa/e1": external("e1") },
    };
    render(
      <TooltipProvider>
        <SessionsHub
          store={store}
          state={state as never}
          onOpen={() => {}}
          isOpen={() => false}
          density="comfortable"
        />
      </TooltipProvider>,
    );
    await unfoldAll(act);
    await settle(() => screen.queryByRole("listitem", { name: "e1" }) !== null);
    return store;
  }
  const openMenu = async () => {
    const trigger = screen.getByRole("button", { name: "Actions of e1" });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
  };

  test("Mute and Unmute, by the session's own key", async () => {
    const store = await hub();
    await openMenu();
    await click(await screen.findByRole("menuitem", { name: "Mute notifications" }));
    expect(store.notifyPrefs.value.mutedSessions).toEqual(["alfa/e1"]);
    await openMenu();
    await click(await screen.findByRole("menuitem", { name: "Unmute notifications" }));
    expect(store.notifyPrefs.value.mutedSessions).toEqual([]);
  });

  test("Snooze for 1 hour sets the end an hour from now", async () => {
    const store = await hub();
    await openMenu();
    await click(await screen.findByRole("menuitem", { name: "Snooze notifications for 1 hour" }));
    expect(store.notifyPrefs.value.snoozed).toEqual({ "alfa/e1": 1_000_000 + 3_600_000 });
  });
});

describe("notify-prefs-ui: the bell can mark an entry unread (issue #149)", () => {
  test("a read entry offers it, and the row becomes unread", async () => {
    const mem = memoryPlatform();
    mem.items.set(
      "flightdeck.inbox",
      JSON.stringify([
        {
          id: "e1",
          at: new Date().toISOString(),
          title: "Precisa de você",
          body: "wsl · Bash",
          subject: "Sessão A",
          host: "wsl",
          read: true,
        },
      ]),
    );
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await waitFor(() => expect(store.getState().inbox).toHaveLength(1));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Notificações/ }));
    });
    const panelEl = await screen.findByRole("dialog");
    await click(within(panelEl).getByRole("button", { name: "Marcar Sessão A como não lida" }));
    expect(store.getState().inbox[0]?.read).toBe(false);
    expect(
      within(panelEl).queryByRole("button", { name: "Marcar Sessão A como não lida" }),
    ).toBeNull();
  });
});
