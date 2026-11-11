import { describe, expect, test } from "bun:test";
import {
  initialSettingsState,
  type SettingsPlatform,
  SettingsSlice,
  type SettingsSliceState,
} from "../../src/features/settings/index.ts";
import { translator } from "../../src/i18n/index.ts";
import { memoryPlatform } from "../fixtures.ts";

/** A slice over a bare state, with a shortcut API that records what the OS was asked. */
function slice(supported = true) {
  const mem = memoryPlatform();
  const calls: string[] = [];
  let pressed: () => void = () => {};
  const platform: SettingsPlatform = {
    ...mem.platform,
    globalShortcut: {
      supported,
      register: async (accelerator, onPress) => {
        calls.push(`register ${accelerator}`);
        pressed = onPress;
      },
      unregister: async (accelerator) => {
        calls.push(`unregister ${accelerator}`);
      },
    },
    autostart: {
      supported: true,
      isEnabled: async () => false,
      setEnabled: async (enabled) => {
        calls.push(`autostart ${enabled}`);
      },
    },
    showMainWindow: async () => {
      calls.push("show");
    },
  };
  let state: SettingsSliceState = initialSettingsState(platform);
  let opened = 0;
  const settings = new SettingsSlice({
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    platform,
    t: () => translator("en"),
    onShortcut: () => {
      opened += 1;
    },
  });
  return {
    settings,
    calls,
    items: mem.items,
    press: () => pressed(),
    get: () => state,
    opened: () => opened,
  };
}

describe("settings slice (#1596)", () => {
  test("the saved shortcut is registered, and pressing it shows the window and opens the search", async () => {
    const t = slice();
    await t.settings.registerSaved();
    expect(t.calls).toEqual(["register Ctrl+Alt+F"]);
    t.press();
    expect(t.calls).toEqual(["register Ctrl+Alt+F", "show"]);
    expect(t.opened()).toBe(1);
  });

  test("a platform that cannot register shortcuts is not asked to", async () => {
    const t = slice(false);
    await t.settings.registerSaved();
    expect(t.calls).toEqual([]);
    expect(t.get().settings.shortcutProblem).toBeNull();
  });

  test("autostart asks the OS first, then shows the new state", async () => {
    const t = slice();
    await t.settings.setAutostart(true);
    expect(t.calls).toEqual(["autostart true"]);
    expect(t.get().settings.autostart).toBe(true);
  });

  test("a switch is saved as text and shown", () => {
    const t = slice();
    t.settings.setAutoUpdate(false);
    t.settings.setNotifyUpdates(false);
    t.settings.setTeleportPreview(true);
    expect(t.get().settings.autoUpdate).toBe(false);
    expect(t.get().settings.notifyUpdates).toBe(false);
    expect(t.get().settings.teleportPreview).toBe(true);
    expect(t.items.get("flightdeck.autoUpdate")).toBe("false");
    expect(t.items.get("flightdeck.teleportPreview")).toBe("true");
  });
});
