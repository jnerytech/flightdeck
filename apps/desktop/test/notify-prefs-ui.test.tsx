import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { Settings } = await import("../src/ui/Settings.tsx");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

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
      appUpdate={{ upToDate: false } as never}
      onCheckUpdate={() => {}}
      onNotifyUpdates={() => {}}
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

  test("choosing a file keeps it and shows its name; a file that is not audio is refused", async () => {
    const { store } = settings();
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

describe("notify-prefs-ui: the test notification (issue #149)", () => {
  test("delivered", async () => {
    settings();
    await click(within(panel()).getByRole("button", { name: "Send test notification" }));
    await settle(() => within(panel()).queryByRole("status") !== null);
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
    await settle(() => within(panel()).queryByRole("status") !== null);
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
    await click(within(panelEl).getByRole("button", { name: "Marcar como não lida" }));
    expect(store.getState().inbox[0]?.read).toBe(false);
    expect(within(panelEl).queryByRole("button", { name: "Marcar como não lida" })).toBeNull();
  });
});
