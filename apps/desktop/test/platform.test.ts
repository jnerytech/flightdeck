import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const invokes: Array<[string, unknown]> = [];
const opened: string[] = [];
let granted = true;
const sent: unknown[] = [];
let deepLinkHandler: ((urls: string[]) => void) | null = null;
let unlistened = 0;
let autostartOn = false;
const shortcutCalls: Array<[string, string]> = [];
let shortcutHandler: ((event: { state: "Pressed" | "Released" }) => void) | null = null;
let shortcutTaken = false;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    invokes.push([cmd, args]);
    return cmd === "token_get" ? "segredo" : undefined;
  },
  // @tauri-apps/api/event (the tray's clicks) imports it; without it this file fails to load alone.
  transformCallback: () => 0,
}));
mock.module("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => granted,
  requestPermission: async () => "denied",
  sendNotification: (n: unknown) => sent.push(n),
}));
mock.module("@tauri-apps/plugin-opener", () => ({
  openUrl: async (url: string) => {
    opened.push(url);
  },
}));
mock.module("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: async () => ["flightdeck://inicial:1?token=a"],
  onOpenUrl: async (handler: (urls: string[]) => void) => {
    deepLinkHandler = handler;
    return () => {
      unlistened++;
    };
  },
}));
mock.module("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => autostartOn,
  enable: async () => {
    autostartOn = true;
  },
  disable: async () => {
    autostartOn = false;
  },
}));

/** What the updater plugin offers (null: up to date) and what the app did with it. */
let updateOffer: { version: string; body?: string } | null = null;
const updaterCalls: string[] = [];
mock.module("@tauri-apps/plugin-updater", () => ({
  check: async () =>
    updateOffer && {
      ...updateOffer,
      downloadAndInstall: async () => {
        updaterCalls.push("downloadAndInstall");
      },
    },
}));
mock.module("@tauri-apps/plugin-process", () => ({
  relaunch: async () => {
    updaterCalls.push("relaunch");
  },
}));

mock.module("@tauri-apps/plugin-global-shortcut", () => ({
  register: async (accelerator: string, handler: typeof shortcutHandler) => {
    shortcutCalls.push(["register", accelerator]);
    if (shortcutTaken) throw new Error(`HotKey already registered: ${accelerator}`);
    shortcutHandler = handler;
  },
  unregister: async (accelerator: string) => {
    shortcutCalls.push(["unregister", accelerator]);
  },
}));

const { tauriPlatform } = await import("../src/platform/tauri/index.ts");
const { createWebPlatform } = await import("../src/platform/web/index.ts");

function fakeWindow(hash = "") {
  const items = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  const notifications: Array<{ title: string; body?: string }> = [];
  const opens: unknown[][] = [];
  const copies: string[] = [];
  let focused = 0;
  const win = {
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          copies.push(text);
        },
      },
    },
    focus: () => {
      focused++;
    },
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    },
    document: { hasFocus: () => false, title: "Flightdeck" },
    location: { hash },
    open: (...args: unknown[]) => {
      opens.push(args);
      return null;
    },
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
    Notification: Object.assign(
      function (this: unknown, title: string, options?: { body?: string }) {
        notifications.push({ title, body: options?.body });
      } as unknown as { new (title: string, options?: { body?: string }): unknown },
      { permission: "granted", requestPermission: async () => "granted" },
    ),
  };
  return { win, listeners, notifications, opens, copies, focused: () => focused };
}

/**
 * Lints `code` as if it lived at `path` (repo-relative). Biome's stdin mode does not report
 * diagnostics through the exit code, so a real file is written and removed afterwards.
 */
async function lint(path: string, code: string) {
  const root = resolve(import.meta.dir, "../../..");
  const file = resolve(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  try {
    const proc = Bun.spawn([process.execPath, "x", "biome", "lint", path], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output =
      (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    return { code: await proc.exited, output };
  } finally {
    rmSync(file, { force: true });
  }
}

describe("platform", () => {
  test("web: armazenamento, segredos em memória, foco e link externo", async () => {
    const { win, opens } = fakeWindow();
    const platform = createWebPlatform(win);
    platform.storage.setItem("k", "v");
    expect(platform.storage.getItem("k")).toBe("v");
    expect(await platform.secrets.get("h")).toBeNull();
    await platform.secrets.set("h", "segredo");
    expect(await platform.secrets.get("h")).toBe("segredo");
    await platform.secrets.delete("h");
    expect(await platform.secrets.get("h")).toBeNull();
    expect(platform.isFocused()).toBe(false);
    await platform.openExternal("https://tailscale.com");
    expect(opens).toEqual([["https://tailscale.com", "_blank", "noopener"]]);
    expect(platform.autostart.supported).toBe(false);
    expect(await platform.autostart.isEnabled()).toBe(false);
    await platform.autostart.setEnabled(true);
    await platform.setCloseToTray(false);
  });

  test("web: segredos podem vir de um mapa injetado (fixtures dos testes de UI)", async () => {
    const tokens = new Map([["a", "t1"]]);
    const platform = createWebPlatform(fakeWindow().win, tokens);
    expect(await platform.secrets.get("a")).toBe("t1");
    await platform.secrets.set("b", "t2");
    expect(tokens.get("b")).toBe("t2");
  });

  test("web: notificação usa a API do navegador e a bandeja vira o título da janela", async () => {
    const { win, notifications } = fakeWindow();
    const platform = createWebPlatform(win);
    await platform.notify({ title: "pc: esperando você", body: "Permitir Bash?" });
    expect(notifications).toEqual([{ title: "pc: esperando você", body: "Permitir Bash?" }]);
    await platform.setTrayStatus({ count: 3, label: "Precisa de você (3)", tooltip: "3 pedidos" });
    expect(win.document.title).toBe("(3) Flightdeck");
    await platform.setTrayStatus({ count: 0, label: "Precisa de você (0)", tooltip: "" });
    expect(win.document.title).toBe("Flightdeck");

    const denied = fakeWindow();
    denied.win.Notification.permission = "default";
    denied.win.Notification.requestPermission = async () => "denied";
    await createWebPlatform(denied.win).notify({ title: "x", body: "y" });
    expect(denied.notifications).toEqual([]);
    const { Notification: _, ...noApi } = fakeWindow().win;
    await createWebPlatform(noApi).notify({ title: "x", body: "y" });
  });

  test("web: deep link chega por #link= na abertura e em hashchange", () => {
    const link = "flightdeck://pc:7420?token=abc";
    const { win, listeners } = fakeWindow(`#link=${encodeURIComponent(link)}`);
    const platform = createWebPlatform(win);
    const received: string[] = [];
    const stop = platform.onDeepLink((url) => received.push(url));
    expect(received).toEqual([link]);
    win.location.hash = "#outra-coisa";
    listeners.get("hashchange")?.();
    win.location.hash = `#link=${encodeURIComponent("flightdeck://b:1?token=z")}`;
    listeners.get("hashchange")?.();
    expect(received).toEqual([link, "flightdeck://b:1?token=z"]);
    stop();
    expect(listeners.has("hashchange")).toBe(false);
  });

  test("tauri: segredos no keyring, link externo, bandeja, fechar para a bandeja e auto-start", async () => {
    const { win } = fakeWindow();
    const platform = tauriPlatform(win);
    expect(await platform.secrets.get("h1")).toBe("segredo");
    await platform.secrets.set("h1", "novo");
    await platform.secrets.delete("h1");
    await platform.setTrayStatus({ count: 2, label: "Precisa de você (2)", tooltip: "2 pedidos" });
    await platform.setCloseToTray(true);
    await platform.openExternal("https://example.com");
    expect(invokes).toEqual([
      ["token_get", { hostId: "h1" }],
      ["token_set", { hostId: "h1", token: "novo" }],
      ["token_delete", { hostId: "h1" }],
      ["tray_set_status", { count: 2, label: "Precisa de você (2)", tooltip: "2 pedidos" }],
      ["set_close_to_tray", { enabled: true }],
    ]);
    expect(opened).toEqual(["https://example.com"]);
    expect(platform.autostart.supported).toBe(true);
    await platform.autostart.setEnabled(true);
    expect(await platform.autostart.isEnabled()).toBe(true);
    await platform.autostart.setEnabled(false);
    expect(await platform.autostart.isEnabled()).toBe(false);
    expect(platform.isFocused()).toBe(false);
    platform.storage.setItem("a", "b");
    expect(platform.storage.getItem("a")).toBe("b");
  });

  test("tauri: notificação só com permissão; deep links da abertura e ao vivo", async () => {
    const platform = tauriPlatform(fakeWindow().win);
    await platform.notify({ title: "a", body: "b" });
    granted = false;
    await platform.notify({ title: "c", body: "d" });
    expect(sent).toEqual([{ title: "a", body: "b" }]);

    const received: string[] = [];
    const stop = platform.onDeepLink((url) => received.push(url));
    await Bun.sleep(5);
    deepLinkHandler?.(["flightdeck://x:2?token=t"]);
    expect(received).toEqual(["flightdeck://inicial:1?token=a", "flightdeck://x:2?token=t"]);
    stop();
    await Bun.sleep(5);
    expect(unlistened).toBe(1);
  });

  test("web: copiar texto, trazer a janela; sem atalho global no navegador", async () => {
    const fake = fakeWindow();
    const platform = createWebPlatform(fake.win);
    await platform.copyText("claude --resume abc");
    expect(fake.copies).toEqual(["claude --resume abc"]);
    await platform.showMainWindow();
    expect(fake.focused()).toBe(1);
    expect(platform.globalShortcut.supported).toBe(false);
    let pressed = 0;
    await platform.globalShortcut.register("Ctrl+Alt+F", () => pressed++);
    await platform.globalShortcut.unregister("Ctrl+Alt+F");
    expect(pressed).toBe(0);
    // A page without the Clipboard API fails loudly instead of pretending it copied.
    const { navigator: _, ...noClipboard } = fakeWindow().win;
    expect(
      await createWebPlatform(noClipboard)
        .copyText("x")
        .catch((e: Error) => e.message),
    ).toBe("área de transferência indisponível");
  });

  test("tauri: atalho global pelo plugin, janela pela Rust e cópia pela área de transferência", async () => {
    const fake = fakeWindow();
    const platform = tauriPlatform(fake.win);
    expect(platform.globalShortcut.supported).toBe(true);
    let pressed = 0;
    await platform.globalShortcut.register("Ctrl+Alt+F", () => pressed++);
    shortcutHandler?.({ state: "Pressed" });
    shortcutHandler?.({ state: "Released" });
    expect(pressed).toBe(1);
    await platform.globalShortcut.unregister("Ctrl+Alt+F");
    expect(shortcutCalls).toEqual([
      ["register", "Ctrl+Alt+F"],
      ["unregister", "Ctrl+Alt+F"],
    ]);
    shortcutTaken = true;
    const refused = await platform.globalShortcut
      .register("Ctrl+Alt+G", () => {})
      .catch((e: Error) => e.message);
    expect(refused).toBe("HotKey already registered: Ctrl+Alt+G");

    await platform.showMainWindow();
    expect(invokes.at(-1)).toEqual(["focus_main", undefined]);
    await platform.copyText("claude --resume abc");
    expect(fake.copies).toEqual(["claude --resume abc"]);
  });

  test("tauri: o updater do plugin consulta, baixa, instala e reinicia; sem consulta não instala", async () => {
    const platform = tauriPlatform(fakeWindow().win);
    expect(platform.updater.supported).toBe(true);
    const early = await platform.updater.install().catch((e: Error) => e.message);
    expect(early).toBe("nenhuma atualização encontrada para instalar");
    expect(await platform.updater.check()).toBeNull();
    updateOffer = { version: "0.9.1", body: "Notas" };
    expect(await platform.updater.check()).toEqual({ version: "0.9.1", notes: "Notas" });
    await platform.updater.install();
    expect(updaterCalls).toEqual(["downloadAndInstall", "relaunch"]);
    updateOffer = { version: "0.9.2" };
    expect(await platform.updater.check()).toEqual({ version: "0.9.2", notes: "" });
  });

  test("lint barra @tauri-apps/* fora de src/platform/tauri", async () => {
    const code = 'import { invoke } from "@tauri-apps/api/core";\nexport const x = invoke;\n';
    const inUi = await lint("apps/desktop/src/ui/__lint_probe__.tsx", code);
    expect(inUi.code).not.toBe(0);
    expect(inUi.output).toContain("noRestrictedImports");
    const inLib = await lint("apps/desktop/src/lib/__lint_probe__.ts", code);
    expect(inLib.code).not.toBe(0);
    const inPlatform = await lint("apps/desktop/src/platform/tauri/__lint_probe__.ts", code);
    expect(inPlatform.code).toBe(0);
  });
});
